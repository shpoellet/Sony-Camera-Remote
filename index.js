var fs = require('fs');
var url = require('url');
var http = require('http');
var semver = require('semver');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

var minVersionRequired = '2.1.4';

//------------------------------------------------------------------------------
//Private Variables

//states
var active = true; //Should the system attemt to connect to the camera
var connected = 'notConnected'; //notConnected, connecting, connected
var recording = false;
var downloading = false;
var waitingForReply = false;

var connectTime = Date.now() - 5000;

var url = '192.168.122.1';
var port = 10000;
var path = '/sony/camera';
var connectionMethod = "old";
var id = 1;

var cameraEvents = {};


//------------------------------------------------------------------------------
//Private Functions
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
    timeout: 1000,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)}
  };

  function httpCallback(res){ //callback function for http.request
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
  req.end();

  req.on('error', function(err){
    if(err && err.code) {
      console.log("SonyWifi: network appears to be disconnected (error for " + method + ": " + err + ", err.code:", err.code, ")");
    }
    callback && callback(err);
  });

}


function processGetEvent(events){
  for(var i = 0; i < events.length; i++){
    if(events[i]){
      switch (events[i].type) {
        case 'cameraStatus':
          cameraEvents.cameraStatus = events[i].cameraStatus;
          break;
        case 'liveviewStatus':
          cameraEvents.cameraStatus = events[i].liveviewStatus;
          break;
        case 'liveviewStatus':
          cameraEvents.cameraFunction = events[i].currentCameraFunction;
          break;
      }
    }
  }
}


function connect(){
  connected = 'connecting';
  console.log("SonyWifi: checkingConnection");

  function connectCallback(err, output){
    if(err){
      connected = 'notConnected'
      console.log("SonyWifi: failed to connect", err);
    }
    else {
      connected = 'connected';
      console.log('SonyWifi: Connected');
      processGetEvent(output);
    }
  }

  call('getEvent', [false], null, null, connectCallback);
}


function tick()
{
  if(active){
    switch (connected) {
      case 'notConnected':

        if ((Date.now() - connectTime) > 5000){
          connect()
          connectTime = Date.now();
        };


        break;
      case 'connecting':
        break;
      case 'connected':
        if ((Date.now() - connectTime) > 2000){
          connect()
          connectTime = Date.now();
        };
        break;

    }
  }
  else{
    connected ='notConnected';
  }
}




setInterval(tick, 100);






// exports.connect = function(){ connect()};
