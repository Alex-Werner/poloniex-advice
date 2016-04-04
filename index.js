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

var client = new elasticsearch.Client({
  host: config.elasticsearch,
  log: 'info'
});

var lastAdvice;

setInterval(function() {
  client.search({
    index: 'poloniex_btc_eth-' + moment().format('YYYY.MM.DD'),
    type: 'sell',
    body: {
      "query": {
        "range": {
          "@timestamp": {
            "gte": "now-30m",
            "lte": "now"
          }
        }
      },
      "size": 0,
      "aggs": {
        "sell": {
          "date_histogram": {
            "field": "@timestamp",
            "interval": "10s"
          },
          "aggs": {
            "avg_sell_price": {
              "avg": {
                "field": "rate"
              }
            },
            "short_moving_avg": {
              "moving_avg": {
                "buckets_path": "avg_sell_price",
                "window": 5,
                "model": "simple"
              }
            },
            "long_moving_avg": {
              "moving_avg": {
                "buckets_path": "avg_sell_price",
                "window": 15,
                "model": "simple"
              }
            }
          }
        }
      }
    }
  }, function(error, response) {

    if (error) {
      console.log(error);
      return;
    }

    var buckets = response.aggregations.sell.buckets;

    var lastDirection;
    var count;

    var lastVariation = 0;
    var variation;

    var lastAvgPrice;

    _.each(buckets, function(agg) {

      if (agg.short_moving_avg) {

        variation = (agg.short_moving_avg.value - agg.long_moving_avg.value) / agg.long_moving_avg.value;

        //long
        if (agg.short_moving_avg.value > agg.long_moving_avg.value) {

          if (lastDirection === 'long' && variation > lastVariation && agg.avg_sell_price.value > agg.short_moving_avg.value ) {
            count++;
          } else if (lastDirection !== 'long') {
            lastDirection = 'long';
            count = 1;
          }

        } else if (agg.short_moving_avg.value < agg.long_moving_avg.value) {

          if (lastDirection === 'short' && variation < lastVariation && agg.avg_sell_price.value < agg.short_moving_avg.value) {
            count++;
          } else if (lastDirection !== 'short') {
            lastDirection = 'short';
            count = 1;
          }
        }

        lastVariation = variation;
      }

      if (agg.avg_sell_price) {
        lastAvgPrice = agg.avg_sell_price.value;
      }

    });


    // console.log('Direction : ' + lastDirection + ' Count ' + count);

    if (((count > 1 && lastDirection === 'long') || (count > 1 && lastDirection === 'short')) && lastDirection !== lastAdvice) {

      if (lastAdvice) {

        var mapping = {
          'short': 'sell',
          'long': 'buy'
        };

        var advice = mapping[lastDirection];

        // console.log(moment().format() + ' - Do it now!! -> ' + advice);

        adviceEventEmiter.emit('advice', {
          type: advice,
          lastAvgPrice: lastAvgPrice
        });

        client.create({
          index: 'poloniex_btc_eth-' + moment().format('YYYY.MM.DD'),
          type: 'advice',
          body: {
            '@timestamp': new Date(),
            tags: ['advice'],
            title: advice,
            desc: 'test'
          }
        }, function(error, response) {});

      }

      lastAdvice = lastDirection;

    }

  });
}, 10000);
