angular.module('VidStreamApp', ['VidStreamApp.controllers', 'VidStreamApp.directives', 'ngAnimate']);

//main Angular module
angular.module('VidStreamApp.controllers', []).controller('mainController', function($scope, $rootScope, $interval) {

	$scope.progress = false;
	$scope.uploadPercent = 0;
	$scope.processPercent = 0;

	//initialize the Socket.IO environment
	$scope.socket = io();

	$scope.uploadFile = function() {
		var oData = new FormData();
		oData.append("file", document.getElementById("file").files[0]);
		var oReq = new XMLHttpRequest();
		oReq.upload.addEventListener('progress', function(e) {
			$scope.$apply(function () {
				$scope.uploadPercent = Math.floor(e.loaded / e.total * 100).toFixed(0);
			});
		}, false);
		oReq.open("post", "upload", true);
		oReq.responseType = "text";
		oReq.onreadystatechange = function() {
			if (oReq.readyState == 4 && oReq.status == 200) {
				$scope.socket.emit('subscribe', oReq.response);
				$scope.$apply(function () {
					$scope.uploadPercent = 0;
				});
			} else if (oReq.readyState == 4 && oReq.status !== 200) {
				alert("There was an error uploading your file");
			}
		}
		$("#file").prop('disabled', true);
		$("#upload").prop('disabled', true);
		$scope.progress = true;
		oReq.send(oData);
	}

	//whenever the socket disconnects and reconnects, request the files from the server
	$scope.socket.on('reconnect', function(num) {
		//nothing
	});

	$scope.socket.on('progress', function (msg){
		$scope.$apply(function () {
			$scope.processPercent = Math.floor(msg).toFixed(0);
			if ($scope.processPercent >= 100) {
				try {
					$scope.progress = false;
					$scope.processPercent = 0;
					$("#file").prop('disabled', false);
					$("#upload").prop('disabled', false);
					$("#file").replaceWith($("#file").clone());
				} catch (e) {}
			}
		});
	});
});