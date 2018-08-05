var fs = require('fs');
var url = require('url');
var http = require('http');
// var semver = require('semver');
var util = require('util');
var events = require('events').EventEmitter;
var EventEmitter = new events.EventEmitter();
var ExportsEmitter = new events.EventEmitter();
var minVersionRequired = '2.1.4';


exports.events = ExportsEmitter;
//------------------------------------------------------------------------------
//Private Variables

//states
var active = true; //Should the system attemt to connect to the camera
var connectedState = 'notConnected'; //notConnected, connecting, connected
var recording = false;
var downloading = false;
var packetSent = false;

var downloadPath = '';

var connectTime = Date.now() - 5000;

var url = '192.168.122.1';
var port = 10000;
var path = '/sony/camera';
var connectionMethod = "old";
var id = 1;

var cameraEvents = {};

var downloadMacro = false;

//------------------------------------------------------------------------------
//Private Functions

//Calls the API method on the camera, callback is called when data is received
function call(method, params, altPath, altVersion, callback){
  var rpcReq = { //object to hold the request paramaters
    id: id,
    method: method,
    params: params || [],
    version: altVersion || '1.0'
  };
  var postData = JSON.stringify(rpcReq); //convert the object to a stringify
  var httpOptions = { //options for http request
    method: 'POST',
    hostname: url,
    port: port,
    path: altPath || path,
    timeout: 5000,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)}
    };
    function httpCallback(res){ //callback function for http.request
      EventEmitter.emit('packetReset');
      var rawData = '';
      var parsedData = null;
      res.setEncoding('utf8');
      res.on('data', function(chunk) {
        rawData += chunk;
      });
      res.on('end', function(){
        try {
          parsedData = JSON.parse(rawData);
          var result = parsedData ? parsedData.result : null;
          var result = parsedData.results ? parsedData.results : result;
          var error = parsedData ? parsedData.error : null;
          if(error) {
            console.log("SonyWifi: error during request", method, error);
          }
          callback && callback(error, result);
        } catch (e) {
          console.log(e.message);
          callback && callback(e);
        }
      });
    };
    var req = http.request(httpOptions, httpCallback);
    req.write(postData);
    EventEmitter.emit('packetSent');
    req.end();
    req.on('error', function(err){
      EventEmitter.emit('packetReset');
      if(err && err.code) {
        console.log("SonyWifi: network appears to be disconnected");
      }
      callback && callback(err);
    });
    req.on('timeout', ()=>req.abort());
}

//Processed the data received by a "getEvent" API call
function processGetEvent(events){
  for(var i = 0; i < events.length; i++){
    if(events[i]){
      switch (events[i].type) {
        case 'cameraStatus':
          cameraEvents.cameraStatus = events[i].cameraStatus;
          break;
        case 'liveviewStatus':
          cameraEvents.liveviewStatus = events[i].liveviewStatus;
          break;
        case 'cameraFunction':
          cameraEvents.cameraFunction = events[i].currentCameraFunction;
          break;
        case 'shootMode':
          cameraEvents.shootMode = events[i].currentShootMode;
          break;
      }
    }
  }
  EventEmitter.emit('getEventProcessed');
}

//Checks the connection of the camera using the "getEvent" API call
function connect(){
  if (connectedState != 'connected'){connectedState = 'connecting';}

  function connectCallback(err, output){
    if(err){

        EventEmitter.emit('connectionTimeout');
        console.log("SonyWifi: failed to connect", err);

    }
    else {
      if (connectedState != 'connected'){EventEmitter.emit('connectionEstablished');}
      processGetEvent(output);
    }
  }

  if(!packetSent){
    call('getEvent', [false], null, null, connectCallback);
  }
  // else{
  //   console.log("packet already sent")
  // }
}

//Set the mode of the camera
function setFunction(value){

  function functionCallback(err, output){
    if(err){
      EventEmitter.emit('functionSwitchFailed', value);
      console.log("SonyWifi: failed to switch camera function", err);
    }
    else {
      EventEmitter.emit('functionSwitched', value);
      console.log('SonyWifi: function Switched ' + value);
    }
  }

  call('setCameraFunction', [value], null, null, functionCallback);
}

//Set the shootMode
function setMode(value){
  function modeCallback(err, output){
    if(err){
      EventEmitter.emit('modeSwitchFailed', value);
      console.log("SonyWifi: failed to switch camera mode", err);
    }
    else {
      EventEmitter.emit('modeSwitched', value);
      console.log('SonyWifi: shootMode set ' + value);
    }
  }
  call('setShootMode', [value], null, null, modeCallback);
}

//Start recording
//camera should be in movie mode or err will be thrown by camera
function startMovieRec(){
  function startMovieCallback(err, output){
    if(err){
      EventEmitter.emit('startMovieFailed');
      console.log("SonyWifi: failed to start recording", err);
    }
    else {
      EventEmitter.emit('movieRecStarted');
      console.log('SonyWifi: Movie Recording Started');
    }
  }
  call('startMovieRec', [], null, null, startMovieCallback);
}

//Stop recording
//camera should be in movie mode or err will be thrown by camera
function stopMovieRec(){
  function startMovieCallback(err, output){
    if(err){
      EventEmitter.emit('stopMovieFailed');
      console.log("SonyWifi: failed to stop recording", err);
    }
    else {
      EventEmitter.emit('movieRecStopped');
      console.log('SonyWifi: Movie Recording Stopped');
    }
  }
  call('stopMovieRec', [], null, null, startMovieCallback);
}

//Get file info
//camera should be in file transfer mode or err will be returned
function getFile(remove){
  function getFileCallback(err, output){
    if(err){
      EventEmitter.emit('getFileFailed');
      console.log("SonyWifi: failed to get file info", err);
    }
    else {
      var uri = output[0][0].uri;
      var url = output[0][0].content.original[0].url;
      EventEmitter.emit('gotFileInfo', uri, url, remove);
      console.log('SonyWifi: retreived file info');
    }
  }

  var params ={};
  params.uri = 'storage:memoryCard1';
  params.stIdx = 0;
  params.cnt = 1;
  // params.type = null;
  params.view = 'flat';
  params.sort = 'descending';

  call('getContentList', [params], '/sony/avContent', '1.3', getFileCallback);
}

//Delete File
//camera should be in file transfer mode or err will be returned
function deleteFile(uri){
  function deleteFileCallback(err, output){
    if(err){
      EventEmitter.emit('deleteFileFailed', uri);
      console.log("SonyWifi: failed to delete", err);
    }
    else {
      connect();
      setTimeout(function(){EventEmitter.emit('fileDeleted');}, 250);

      console.log('SonyWifi: deleted');
    }
  }

  var params ={};
  params.uri = [uri];

  call('deleteContent', [params], '/sony/avContent', '1.1', deleteFileCallback);
}

//Download file
//Downloades a file from the cameras
function downloadFile(uri, url, remove, id)
{
  var path = downloadPath + id + ['.mp4'];
  var file =  fs.createWriteStream(path);
  http.get(url, function(response){
    response.pipe(file);
    EventEmitter.emit('downloadStarted', uri);
    downloading = true;
    response.on('end', function(){
      EventEmitter.emit('downloadComplete', uri, path, remove)
    });
  });
}

//function to be called on a regular interval
function tick()
{
  if(active){
    switch (connectedState) {
      case 'notConnected':

        if (((Date.now() - connectTime) > 5000) & !packetSent){
          connect()
          connectTime = Date.now();
        };


        break;
      case 'connecting':
        break;
      case 'connected':
        if ((Date.now() - connectTime) > 500){
          connect()
          connectTime = Date.now();
        };
        break;

    }
  }
  else{
    connectedState ='notConnected';
  }
}



//start tick loop
setInterval(tick, 100);


//------------------------------------------------------------------------------
//Event handlers
EventEmitter.on('packetSent', function(){
  packetSent = true;
})

EventEmitter.on('packetReset', function(){
  packetSent = false;
})

EventEmitter.on('connectionEstablished', function(){
  console.log('SonyWifi: Connection Established');
  connectedState = 'connected';
  ExportsEmitter.emit('connect');
})

EventEmitter.on('connectionTimeout', function(){
  console.log('SonyWifi: Connection Lost');
  connectedState = 'notConnected';
  recording = false;
  downloading = false;
  ExportsEmitter.emit('lostConnection');
})

EventEmitter.on('getEventProcessed', function(){
  ExportsEmitter.emit('status', cameraEvents.cameraFunction,
                                cameraEvents.cameraStatus,
                                cameraEvents.shootMode,
                                cameraEvents.liveviewStatus);
})

EventEmitter.on('functionSwitched', function(value){

  if(downloadMacro){ //check if the system is in macro mode
    if((value == 'Contents Transfer') && !downloading){
      var delayCount = 0;  //number ot times the delay count has been run
      function delayLoop(){
        if(cameraEvents.cameraStatus == 'ContentsTransfer'){  //camera is ready
          getFile(true);
        }
        else if(delayCount <= 7){//camera is not ready so delay and try again
          delayCount++;
          setTimeout(delayLoop, 500);
        }
        else{//delay did not work so stop the macro
          EventEmitter.emit('terminateDownloadMacro');
        }
      }
      delayLoop();
    }

    else if(value == 'Remote Shooting'){
      var delayCount = 0;  //status of it the loop has been delayed
      function delayLoop2(){
        if(cameraEvents.cameraStatus == 'IDLE'){  //camera is ready
          EventEmitter.emit('downloadMacroComplete');
        }
        else if(delayCount <= 7){//camera is not ready so delay and try again
          delayCount++;
          setTimeout(delayLoop2, 500);
        }
        else{//delay did not work so stop the macro
          EventEmitter.emit('terminateDownloadMacro');
        }
      }
      delayLoop2();
    }
    else{//conditions not right for macro so stop it
      EventEmitter.emit('terminateDownloadMacro');
    }
  }

  ExportsEmitter.emit('functionChanged', value);
})

EventEmitter.on('functionSwitchFailed', function(value){
  if(downloadMacro){EventEmitter.emit('terminateDownloadMacro')};
})

EventEmitter.on('modeSwitched', function(value){
  ExportsEmitter.emit('modeChanged', value);
})

EventEmitter.on('modeSwitchFailed', function(value){

})

EventEmitter.on('movieRecStarted', function(){
  recording = true;
  ExportsEmitter.emit('movieRecStarted');
})

EventEmitter.on('startMovieFailed', function(){

})

EventEmitter.on('movieRecStopped', function(){
  recording = false;
  ExportsEmitter.emit('movieRecStopped');
})

EventEmitter.on('stopMovieFailed', function(){
  stopMovieRec();
})

EventEmitter.on('getFileFailed', function(){
  if(downloadMacro){EventEmitter.emit('terminateDownloadMacro')};
})

EventEmitter.on('gotFileInfo', function(uri, url, remove){
  downloadFile(uri, url, remove, 'downFile');
})

EventEmitter.on('fileDeleted', function(){
  if(downloadMacro){ //check if the system is in macro mode

    var delayCount = 0;  //number ot times the delay count has been run
    function delayLoop(){
      if(cameraEvents.cameraStatus == 'ContentsTransfer'){  //camera is ready
        setFunction('Remote Shooting');
      }
      else if(delayCount <= 7){//camera is not ready so delay and try again
        delayCount++;
        setTimeout(delayLoop, 500);
      }
      else{//delay did not work so stop the macro
        EventEmitter.emit('terminateDownloadMacro');
      }
    }
    delayLoop();
  }
})

EventEmitter.on('deleteFileFailed', function(){
 if(downloadMacro){EventEmitter.emit('terminateDownloadMacro')};
})

EventEmitter.on('downloadStarted', function(){
  console.log('download started');
})

EventEmitter.on('downloadComplete', function(uri, path, remove){
  console.log('download complete');
  downloading = false;
  ExportsEmitter.emit('downloadComplete', path);
  if(remove){deleteFile(uri)};
})

EventEmitter.on('terminateDownloadMacro', function(){
  downloadMacro = false;
  console.log("Download Macro Terminated");
})

EventEmitter.on('downloadMacroComplete', function(){
  downloadMacro = false;
  console.log("Download Macro Complete");
  ExportsEmitter.emit('downloadMacroComplete');
})

//Public Functions
exports.getStates = function(){
  var states = {
    camFunction:cameraEvents.cameraFunction,
    status:cameraEvents.cameraStatus,
    shootMode:cameraEvents.shootMode,
    liveviewStatus:cameraEvents.liveviewStatus,
    recording:recording
  };
  return states;
}

exports.setShootFunction = function(){
  if((cameraEvents.cameraFunction == 'Contents Transfer') & !recording){
    setFunction('Remote Shooting');
  }
  else{
    console.log("camera can not switch mode")
  }
}

exports.setTransferFunction = function(){
  if((cameraEvents.cameraStatus == 'IDLE') &
     (cameraEvents.cameraFunction == 'Remote Shooting')){
    setFunction('Contents Transfer');
  }
  else{
    console.log("camera not in shooting mode")
  }
}

exports.setMovieMode = function(){
  if(cameraEvents.cameraFunction == 'Remote Shooting'){
    setMode('movie');
  }
}

exports.recordStart = function(){
  if((cameraEvents.cameraFunction == 'Remote Shooting') &
     (cameraEvents.shootMode == 'movie') &
     (cameraEvents.cameraStatus == 'IDLE')){
       startMovieRec();
     }
  else{
    console.log("camera busy");
  }
}

exports.recordStop = function(){
  if((cameraEvents.cameraFunction == 'Remote Shooting') &
     (cameraEvents.shootMode == 'movie') &
     (cameraEvents.cameraStatus == 'MovieRecording')){
       stopMovieRec();
     }
  else{
    console.log("camera not recording");
  }
}

exports.getLastFile = function(remove){
  if((cameraEvents.cameraFunction == 'Contents Transfer') &
     (cameraEvents.cameraStatus == 'ContentsTransfer')){
    getFile(remove);
  }
}

exports.startDownloadMacro = function(){
  downloadMacro = true;
  if(cameraEvents.cameraStatus == 'IDLE'){
    setFunction('Contents Transfer');
  }
  else if((cameraEvents.cameraFunction == 'Contents Transfer') &
          (cameraEvents.cameraStatus == 'ContentsTransfer') & !downloading){
    getFile(true);
  }
  else{
    EventEmitter.emit('terminateDownloadMacro');
    console.log('could not start download macro');
    return false;
  }
  return true;
}

exports.abortDownloadMacro = function(){
  EventEmitter.emit(terminateDownloadMacro);
}
