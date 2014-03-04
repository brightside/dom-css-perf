/* global require, define */
require.config({paths: {jquery:"vendor/jquery/jquery-2.0.3"}});

define([
  'lib/angular_lazy_scroll',
  'jquery',
], function(angular_lazy_scroll, $) { "use strict";

var module = angular.module('demo_angular_lazy', ['lib/angular_lazy_scroll'], function() {});

module.controller("DemoCtrl", ['$scope', function($scope) {
    $scope.counts = [
        10, 100, 1000, 10000, 1000 * 1000 ];
    // $scope.count_i = $scope.counts.length - 1;
    $scope.count_i = 3;
    $scope.cycle = function() {
        $scope.count_i = ($scope.count_i + 1) % $scope.counts.length;
    };
    $scope.items = {
        count: function() { return $scope.counts[$scope.count_i]; },
        data: function(i) { return i; },
        height: function(/* i */) { return 40; },
    };
    var main = $("#main");
    var h = window.innerHeight - main.offset().top - 10;
    main.height(h);
    // $("#bar").height(h);
}]);

angular.bootstrap(document.getElementById("demo"), ['demo_angular_lazy']);

});
