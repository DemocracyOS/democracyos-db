var semver = require('semver');
var muri = require('muri');
var rgxReplSet = /^.+,.+$/;
var log = require('debug')('democracyos:db');

var ALLOWED_MONGOOSE_VERSION = '3.8.24';

function Db(mongoose) {
  if (!(this instanceof Db)) return new Db(mongoose);

  if (!semver.satisfies(mongoose.version, ALLOWED_MONGOOSE_VERSION)) {
    throw new Error('democracyos-db only accepts "' + ALLOWED_MONGOOSE_VERSION + '" version of "mongoose".');
  }

  this.mongoose = mongoose;
}

module.exports = Db;

Db.prototype.getDefaultConnection = function getDefaultConnection (){
  return this.mongoose.connection;
}

Db.prototype.createConnection = function createConnection (mongoUri){
  return performConnection(this.mongoose, this.mongoose.createConnection(), buildOpts(muri(mongoUri)));
}

Db.prototype.connect = function connect (mongoUri) {
  return performConnection(this.mongoose, this.mongoose.connection, buildOpts(muri(mongoUri)));;
}

function performConnection (mongoose, connection, opts) {
  var dbOptions = {
    db: {
      journal: true,
      retryMiliSeconds: 5000,
      numberOfRetries: 1000000,
      read_preference: 'secondaryPreferred'
    },
    auto_reconnect: true,
    server: {
      poolSize: parseInt(process.env.MONGO_POOL_SIZE || 5, 10),
      auto_reconnect: true,
      socketOptions: {
        connectTimeoutMS: 20000,
        keepAlive: 1
      }
    }
  };

  var uri = [];

  if (opts.hosts) {
    var nodes = opts.hosts.split(',');
    log('Using mongodb hosts: %s', nodes);

    for (var index = 0; index < nodes.length; index++) {
      uri.push('mongodb://' + nodes[index]);
      if (index === 0) {
        uri.push('/');
        uri.push(opts.dbname);
      }

      if (index + 1 < nodes.length) {
        uri.push(',');
      }
    }

    uri = uri.join('');

    log('Using mongodb URI: %s', uri);

    // TODO: according to docs, this defaults to '1'
    // dbOptions.db.w = 'majority';

    dbOptions.server.slaveOk = true;

    dbOptions.replset = {
      haInterval: 500,
      reconnectWait: 5000,
      poolSize: parseInt(process.env.MONGO_POOL_SIZE || 5, 10),
      retries: 10000000,
      readPreference: 'secondaryPreferred',
      rs_name: opts.replSetName || 'rs0',
      slaveOk: true,
      socketOptions: {
        connectTimeoutMS: 20000,
        keepAlive: 1
      }
    };

  } else {
    uri = 'mongodb://' + process.env.MONGO_HOST + ':' +
        (process.env.MONGO_PORT || 27017) + '/' + opts.dbname;
  }

  if (opts.mongoUser && opts.mongoPassword) {
    dbOptions.user = opts.mongoUser;
    dbOptions.pass = opts.mongoPassword;
  }

  connection.on('error', function(err) {
    log('mongo %s error: %s', uri, err);
    log(err);
  });

  connection.on('reconnect', function() {
    log('Recconecting to MongoDB on URI: %s', uri);
  });

  connection.on('connected', function() {
    log('Connected to MongoDB on URI: %s', uri);
  });

  connection.on('connecting', function() {
    log('Connecting to MongoDB database %s', opts.dbname);
  });

  connection.on('disconnected', function(err) {
    log('Discnnected from MongoDB on URI: %s - Error: %s', uri, err);
  });

  connection.on('open', function() {
    log('Connection to MongoDB is now OPEN on URI: %s', uri);
  });

  if (isReplSet(uri)){
    connection.openSet(uri, dbOptions);
  } else {
    connection.open(uri, dbOptions);
  }

  return connection;
}

function isReplSet(mongoUri) {
  return rgxReplSet.test(mongoUri);
}

function buildOpts(uriObj) {
  return {
    hosts: uriObj.hosts.map(serialize).join(','),
    dbname: uriObj.db,
    replSetName: uriObj.options.replicaSet,
    mongoUser: uriObj.auth ? uriObj.auth.user : undefined,
    mongoPassword: uriObj.auth ? uriObj.auth.pass : undefined,
  };
}

function serialize(conn) {
  return conn.host + ':' + conn.port;
}