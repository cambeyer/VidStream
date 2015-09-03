angular.module('VidStreamApp', ['VidStreamApp.controllers', 'VidStreamApp.directives', 'ngAnimate']);

//main Angular module
angular.module('VidStreamApp.controllers', []).controller('mainController', function($scope, $rootScope, $interval) {

	$scope.progress = false;
	$scope.uploadPercent = 0;
	$scope.processPercent = 0;

	$scope.authed = false;
	$scope.authing = false;

	$scope.confirmPassword = false;

	$scope.fields = {
		username: "",
		password: "",
		passwordConfirm: ""
	};

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

	$scope.socket.on('reconnect', function(num) {
		$scope.login();
	});

	$scope.login = function() {
		if ($scope.fields.username && $scope.fields.password) {
			$scope.authing = true;
			if ($scope.confirmPassword) {
				if ($scope.fields.passwordConfirm == $scope.fields.password) {
					alert("Welcome to VidStream; your account will now be created");
					$scope.sendEncrypted($scope.tempKey);
					$scope.$apply(function () {
						$scope.confirmPassword = false;
					});
				} else {
					alert("Your passwords do not match");
					$scope.$apply(function () {
						$scope.fields.password = "";
						$scope.authing = false;
					});
				}
			} else {
				$scope.socket.emit('login', $scope.fields.username);
			}
		}
	}

	$scope.socket.on('encrypt', function (requestObj) {
		if ($scope.authing) {
			if (requestObj.newUser) {
				alert("Please confirm your password to create your account.");
				$scope.$apply(function () {
					$scope.confirmPassword = true;
					$scope.tempKey = requestObj.publicKey;
				});
			} else {
				$scope.sendEncrypted(requestObj.publicKey);
			}
		} else {
			//Hacking attempt detected
		}
	});

	$scope.sendEncrypted = function(publicKey) {
		var encryptor = new JSEncrypt();
		encryptor.setPublicKey(publicKey);
		var response = {};
		response.username = $scope.fields.username;
		response.message = encryptor.encrypt(CryptoJS.MD5($scope.fields.password).toString());
		$scope.socket.emit('encrypt', response);
	}

	$scope.socket.on('login', function (successBool) {
		$scope.$apply(function () {
			$scope.authing = false;
			$scope.authed = successBool;
			if (!$scope.authed) {
				$scope.error = true;
			} else {
				$scope.error = false;
				//load list of videos from the server
			}
		});
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