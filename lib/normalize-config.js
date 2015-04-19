/**
 * Created by novacrazy on 4/19/2015.
 */

var _ = require( 'lodash' );
var path = require( 'path' );

exports.normalize = normalizeConfig;

function isNull(value) {
    return value === null || value === void 0;
}

function parseDeps(deps, paths) {
    if( _.isObject( deps ) && !_.isArray( deps ) ) {
        return _.map( deps, function(v, k) {

            //If deps have a specified path, use that instead, but only if it hasn't already been defined
            if( !paths[k] ) {
                paths[k] = v;
            }

            return k;
        } );

    } else if( !_.isArray( deps ) ) {
        return [/*No valid dependencies*/];

    } else {
        return deps;
    }
}

function normalizeConfig(config) {
    var isObject = _.isObject( config ) && !Array.isArray( config );

    var defaultConfig = {
        baseUrl: '.' + path.sep, //String
        paths:   {},   //Object
        deps:    [],   //Array
        shim:    {}    //Object
    };

    if( isObject ) {
        config = _.defaults( config, defaultConfig );

    } else {
        return defaultConfig;
    }

    //Normalize baseUrl
    if( typeof config.baseUrl === 'string' ) {
        config.baseUrl = path.normalize( config.baseUrl );

    } else {
        config.baseUrl = defaultConfig.baseUrl;
    }

    //Make sure paths is an object
    if( !_.isObject( config.paths ) || Array.isArray( config.paths ) ) {
        config.paths = defaultConfig.paths;
    }

    //Make sure shim is an object
    if( !_.isObject( config.shim ) || Array.isArray( config.shim ) ) {
        config.shim = defaultConfig.shim;
    }

    //Normalize deps
    config.deps = parseDeps( config.deps, config.paths );

    //Normalize shims
    config.shim = _( config.shim ).mapValues( function(shim) {
        if( Array.isArray( shim ) ) {
            return {
                deps: parseDeps( shim, config.paths )
            };

        } else if( _.isObject( shim ) && typeof shim.exports === 'string' ) {
            return {
                deps:    parseDeps( shim.deps, config.paths ),
                exports: shim.exports
            };
        }

    } ).omit( isNull ).value();

    //Normalize paths
    config.paths = _( config.paths ).mapValues( function(p) {
        if( _.isString( p ) ) {
            return path.resolve( config.baseUrl, p );
        }

    } ).omit( isNull ).value();

    return config;
}
