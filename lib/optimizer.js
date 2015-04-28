/**
 * Created by novacrazy on 4/23/2015.
 */

"use strict";

var _ = require( 'lodash' );

var real_path = require( 'path' );
var path = real_path.posix;
var util = require( 'util' );
var assert = require( 'assert' );

var DepGraph = require( 'dependency-graph' ).DepGraph;
var Promise = require( 'bluebird' );
var co = require( 'co' );

var normalize = require( './normalize-config.js' );

exports.resolve = resolve;
exports.build = build;
exports.resolvePlusDeps = resolvePlusDeps;

/*
 *   $1 = relative part
 *   $3 = base part
 *   $4 = ext part
 *   $2 = base + ext
 * */
let extrasRe = /(\.+\/)?(([\w\-\/]+)(\.\w+)?)/g;

//Just to capture anonymously defined modules
let anonDefineRe = /define\s*\((?!\s*['"])\s*/g;

//Captures all defines (including now non-anonymous defines)
let otherDefineRe = /define\s*\(\s*["']([\w\/]*)['"]\s*,\s*/g; //Use $1

//Captures define deps and everything before it
let defineDepsRe = /(define\s*\(\s*.*?)\[(.*?)\]\s*/g; //$1 for module (and define), $2 for deps

//Captures define statements that are missing a dependency array
let missingDepsRe = /(define\s*\(\s*["']([\w\/]*)['"]\s*,\s*)(?=[^\[])\b/g;

//Although this may not work, it might help anyway
let shimWindowRe = /window\.(\w+)\s*=/; //use $1

function resolve(file, config, name, load) {
    if( typeof name === 'function' ) {
        load = name;
        name = null;

    } else {
        assert( typeof load, 'function', 'load argument must be a function' );
    }

    config = normalize( config );

    if( Array.isArray( file ) ) {
        let dir = name;

        assert( typeof dir, 'string', 'name/dir argument must be a string' );

        if( file.length > 0 ) {
            return Promise.map( file, function(dep) {
                if( config.paths.hasOwnProperty( dep ) ) {
                    return resolve( config.paths[dep], config, dep, load );

                } else {
                    return resolve( pathify( dir, dep ), config, null, load );
                }
            } );

        } else {
            return Promise.resolve( [] );
        }

    } else {
        /*
         * Basic variables for base path, full path, directory and the module name
         * */
        let basePath = config.baseUrl;

        let fullPath = pathify( basePath, file );

        let dir = path.dirname( file );

        let moduleName = name || path.relative( basePath, file ).replace( extrasRe, '$3' );

        /*
         * Determine if the module name is in the paths or not and get the appropriate filepath
         * */
        let inPaths = typeof config.paths[moduleName] === 'string';

        let filepath = inPaths ? path.resolve( basePath, config.paths[moduleName] ) : fullPath;

        /*
         * Load should return a Promise that resolves to the file source, which is passed on to the optimizer
         * */
        return load( filepath, 'utf-8' ).then( function(source) {
            assert.strictEqual( typeof source, 'string', 'load function must return a string of specified encoding' );

            /*
             * Internal modules are for module defined within this specific file and dependencies should be
             * renamed appropriately.
             */
            let internalModules = [];
            /*
             * External dependencies are file references via define([deps])
             * */
            let externalDependencies = [];

            /*
             * Set to true if an anonymous define was detected
             * */
            let anonymousDefine = false;

            /*
             * Shims can be in the form of module 'renaming' or importing something attached to the window
             * */
            let shimNeeded = config.shim[moduleName] !== void 0;
            let shimHasExports = shimNeeded && typeof config.shim[moduleName].exports === 'string';
            let shimAlias = false;

            source = source
                //Find all instances of anonymous defines, but only replace the first one
                .replace( anonDefineRe, function(match) {
                    if( !anonymousDefine ) {
                        anonymousDefine = true;
                        return util.format( 'define("%s", ', moduleName );

                    } else {
                        return match;
                    }
                } )
                //Go on to all other defines and determine how their ids should be renamed
                .replace( otherDefineRe, function(match, $1) {
                    //some fun logic here... to avoid accidental confusion with anonymous modules and shim stuff
                    if( $1 === moduleName && anonymousDefine ) {

                        //If the shim requires something else, undo the anonymous define renaming or any other like it
                        if( shimHasExports && config.shim[moduleName].exports !== $1 ) {
                            return 'define(';

                        } else {
                            return match;
                        }

                    } else {
                        //Determine what kind of shim is needed, if any
                        if( shimNeeded && shimHasExports && config.shim[moduleName].exports === $1 ) {
                            if( $1 === moduleName ) {
                                shimNeeded = false;

                            } else {
                                shimAlias = true;
                            }

                        } else {
                            internalModules.push( $1 );
                        }

                        return util.format( 'define("%s/%s", ', moduleName, $1 );
                    }
                } )
                //Process each defined module's dependencies
                .replace( defineDepsRe, function(match, $1, $2) {
                    //Exploit lodash's chaining system for this
                    let deps = _( $2 )
                        .split( ',' )
                        .without( '' )
                        .map( function(dep) {
                            dep = dep.replace( /['"]/g, '' ).trim();

                            /*
                             * Don't bother with empty dependencies,
                             * it's probably just something like define([], factory)
                             * to appease almond or requirejs.
                             * */
                            if( dep.length > 0 ) {

                                //If this was a plugin, only cite the plugin itself as a dependency
                                if( dep.indexOf( '!' ) !== -1 ) {
                                    let dep_parts = dep.split( '!' );

                                    externalDependencies.push( dep_parts[0] );

                                } else {
                                    //Format internal modules into submodules to avoid namespace clutter issues
                                    if( internalModules.indexOf( dep ) !== -1 ) {
                                        return util.format( '"%s/%s"', moduleName, dep );

                                    } else if( externalDependencies.indexOf( dep ) === -1 ) {
                                        externalDependencies.push( dep );
                                    }

                                    if( !config.paths.hasOwnProperty( dep ) ) {
                                        //make a valid module path and strip any leading slashes or dots
                                        dep = (pathify( dir, dep )).replace( extrasRe, '$2' );
                                    }
                                }

                            } else {
                                //Returning null will remove this item from the array
                                return null;
                            }

                            return '"' + dep.replace( extrasRe, '$3' ) + '"';
                        } )
                        .filter( null )
                        .join( ',' );

                    return util.format( '%s[%s]', $1, deps ); //recombine dependencies and define statement
                } )
                //To satisfy requirejs and almond, this adds an empty array of dependencies where needed
                .replace( missingDepsRe, '$1 [], ' );

            if( shimNeeded ) {
                let shim = config.shim[moduleName];

                //shimAlias implies
                if( shimAlias ) {
                    let exports = shim.exports;

                    source += util.format( '\n\ndefine("%s", ["%s/%s"], function(%s){return %s;});',
                        moduleName, moduleName, exports, exports, exports );

                } else {
                    let match;

                    if( shimHasExports ) {
                        match = shim.exports;

                    } else {
                        //Search for the first occurrence of 'windows.X = '
                        match = source.match( shimWindowRe );

                        if( match != null ) {
                            match = match[1];
                        }
                    }

                    if( typeof match === 'string' ) {
                        source += util.format( '\n\ndefine("%s",function(){return window.%s;});', moduleName, match );
                    }
                }
            }

            return resolve( externalDependencies, config, dir, load ).then( function(resolvedDeps) {
                return {
                    deps:       resolvedDeps,
                    src:        source,
                    moduleName: moduleName,
                    fullPath:   fullPath
                }
            } );
        } );
    }
}

function build(result) {
    var srcMap = new Map();
    var graph = new DepGraph();

    var traverse = co.wrap( function*(parent) {
        if( !graph.hasNode( parent.fullPath ) ) {
            graph.addNode( parent.fullPath );

            srcMap.set( parent.fullPath, parent.src );

            let deps = parent.deps;

            for( let it in deps ) {
                if( deps.hasOwnProperty( it ) ) {
                    let dep = deps[it];

                    if( !graph.hasNode( dep.fullPath ) ) {
                        yield traverse( dep );
                    }

                    graph.addDependency( parent.fullPath, dep.fullPath );
                }
            }
        }
    } );

    var finish = co.wrap( function*() {
        var resultingSource = '';

        var order = graph.overallOrder();

        for( let it in order ) {
            if( order.hasOwnProperty( it ) ) {
                let fullPath = order[it];

                resultingSource += srcMap.get( fullPath ) + '\n\n';
            }
        }

        return resultingSource;
    } );

    if( Array.isArray( result ) ) {
        //This is just freaking neat
        return Promise.map( result, build ).reduce( function(acc, i) {
            return acc + i;
        }, '' );

    } else if( _.isObject( result ) ) {
        return traverse( result ).then( finish );

    } else {
        return Promise.resolve( '' );
    }
}

function resolvePlusDeps(file, config, load) {
    config = normalize( config );

    var resolvingDeps = resolve( config.deps, config, config.baseUrl, load );
    var resolvingFile = resolve( file, config, null, load );

    return Promise.join( resolvingDeps, resolvingFile, function(resolvedDeps, resolvedFile) {
        var buildingDeps = build( resolvedDeps );
        var buildingFile = build( resolvedFile );

        return Promise.join( buildingDeps, buildingFile, function(depSource, fileSource) {
            return depSource + fileSource;
        } );
    } );
}

function pathify(/*...*/) {
    return path.normalize( _( arguments ).filter( null ).reduce( function(acc, t) {
        return acc + path.sep + t;
    } ) );
}
