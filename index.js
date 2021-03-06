var _ = require('lodash');
var elasticsearch = require('elasticsearch');
var moment = require('moment');
var config = require('./config/prod.json');
var adviceEventEmiter = require('./adviceEventEmiter');

var winston = require('winston');
winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, {'timestamp':true});

var plugins = config.plugins;

_.each(plugins, function(plugin) {
  winston.info('Load plugin ' + plugin);
  require('./plugins/' + plugin).init();
});


var method = require('./methods/firstOne');
method.start();
