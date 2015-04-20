/**
 * Created by novacrazy on 4/19/2015.
 */

var _ = require( 'lodash' );
var path = require( 'path' );
var util = require( 'util' );
var DepGraph = require( 'dep-graph' ).DepGraph;

var Promise = require( 'bluebird' );
var co = require( 'co' );

var normalize = require( './normalize-config.js' );

exports.resolve = resolve;
exports.build = build;

//Declare most regular expressions and name them to avoid confusion
let stripRelativeRe = /(\.\/)?([\w\-\/]*)(\.\w+)?/g; //Use $2
let stripExtrasRe = /\.\/([\w\-\/]*)\.\w+/g; //Use $1
let firstDefineRe = /define\s*\(\s*(?!['"])/;
let otherDefineRe = /define\s*\(\s*["']([\w\/]*)['"]/g; //Use $1
let defineDepsRe = /(define\s*\(\s*.*?)\[(.*?)\]/g; //Use $1 for module, $2 for deps
let shimWindowRe = /window\.(\w+)\s*=/; //use $1
//var isMinifiedRe = /.+?\.min\..+?$/i;

function resolve(mod, config, loader, name, readOnly) {
    config = normalize( config );

    let baseUrl = config.baseUrl;
    let dir = path.dirname( mod );
    let url = path.normalize( pathify( baseUrl, mod ) );

    var resolveFromSource = function(source) {
        let moduleName = name || path.relative( baseUrl, mod ).replace( stripRelativeRe, '$2' );

        let internalModules = [];
        let externalDependencies = [];

        let anonymousDefine = false;

        source = source
            //format the top-level define with the module name
            .replace( firstDefineRe, function(match, $1, offset, string) {
                anonymousDefine = true;
                return util.format( 'define("%s", ', moduleName );
            } )
            //replace internal module statements first so it can collect all internal module names
            .replace( otherDefineRe, function(m, $1, offset, string) {
                if( !anonymousDefine && $1 === moduleName ) {
                    return m;

                } else {
                    internalModules.push( $1 );
                    return util.format( 'define("%s/%s"', moduleName, $1 );
                }
            } )
            .replace( defineDepsRe, function(m, $1, $2, offset, string) {
                let deps = _( $2 )
                    .split( ',' ) //split at commas
                    .without( '' ) //don't bother with empty deps
                    .map( function(dep) {
                        dep = dep.replace( /['"]/g, '' ).trim(); //strip ' and " and whitespace from strings

                        if( dep.length > 0 ) {
                            //Account for plugins, let them load their own modules
                            if( dep.indexOf( '!' ) !== -1 ) {
                                let dep_parts = dep.split( '!' );

                                externalDependencies.push( dep_parts[0] );

                            } else {
                                if( internalModules.indexOf( dep ) != -1 ) {
                                    return util.format( '"%s/%s"', moduleName, dep );

                                } else if( externalDependencies.indexOf( dep ) == -1 ) {
                                    externalDependencies.push( dep );
                                }

                                if( !config.paths[dep] ) {
                                    //make a valid module path and strip any leading slashes or dots
                                    dep = (pathify( dir, dep )).replace( /^\.?\/+/, '' );
                                }
                            }
                        }

                        return '"' + dep.replace( stripExtrasRe, '$1' ) + '"';
                    } )
                    .join( ',' ); //join back with commas

                return util.format( '%s[%s]', $1, deps ); //recombine dependencies and define statement
            } );

        if( config.shim[moduleName] ) {
            let shim = config.shim[moduleName];
            let match = shim.exports;

            if( typeof match !== 'string' ) {
                //Search for the first occurrence of 'windows.X = '
                match = source.match( shimWindowRe );

                if( match != null ) {
                    match = match[1];
                }
            }

            if( match != null ) {
                source += util.format( '\n\ndefine("%s",function(){return window.%s;});', moduleName, match );
            }
        }

        return resolveDependencies( dir, config, externalDependencies ).then( function(resolvedDeps) {
            return {
                deps:       resolvedDeps,
                src:        source,
                moduleName: moduleName,
                config:     config
            }
        } );
    };

    //TODO: Load sources and recursively resolve them.
}

function build(result, config, pgraph) {
    let srcMap = new Map();
    let graph = pgraph || new DepGraph();

    var traverse = co.wrap( function*(parent) {
        if( !graph.hasNode( parent.moduleName ) ) {
            graph.addNode( parent.moduleName );

            srcMap.set( parent.moduleName, parent.src );

            let deps = parent.deps;

            for( let it in deps ) {
                if( deps.hasOwnProperty( it ) ) {
                    let dep = deps[it];

                    if( !graph.hasNode( dep.moduleName ) ) {
                        yield traverse( dep );
                    }

                    graph.addDependency( parent.moduleName, dep.moduleName );
                }
            }
        }
    } );

    var finish = co.wrap( function*() {
        let resultingSource = '';

        if( config.deps ) {
            let deps = yield resolveDependencies( helpers.defaultConfig.baseUrl, config, config.deps );

            for( let it in deps ) {
                if( deps.hasOwnProperty( it ) ) {
                    resultingSource += yield build( deps[it], graph );
                }
            }
        }

        let order = graph.overallOrder();

        for( let it in order ) {
            if( order.hasOwnProperty( it ) ) {
                let moduleName = order[it];

                resultingSource += srcMap.get( moduleName ) + '\n\n';
            }
        }

        return resultingSource;
    } );

    return traverse( result ).then( finish );
}

function resolveDependencies(dir, config, deps) {
    if( deps.length > 0 ) {
        return Promise.map( deps, function(dep) {
            if( config.paths[dep] ) {

                return resolve( config.paths[dep], config, dep, true );

            } else {
                return resolve( path.normalize( pathify( dir, dep ) ), config );
            }
        } );

    } else {
        return Promise.resolve( [] );
    }
}

function pathify(/*...*/) {
    return _( arguments ).reduce( function(acc, t) {
        return acc + path.posix.sep + t;
    } );
}
