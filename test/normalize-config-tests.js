/**
 * Created by novacrazy on 4/19/2015.
 */

var assert = require( 'assert' );
var path = require( 'path' );

var normalizeConfig = require( './../lib/normalize-config.js' );

var normalize = normalizeConfig.normalize;

var cwd = '.' + path.sep;

var defaultConfig = {
    baseUrl: cwd, //String
    paths:   {},   //Object
    deps:    [],   //Array
    shim:    {}    //Object
};

describe( 'empty or null configs', function() {
    it( 'should return default config for null input', function() {
        var res = normalize( null );

        assert.deepStrictEqual( res, defaultConfig );
    } );

    it( 'should fill in empty properties for empty object input', function() {
        var res = normalize( {} );

        assert.deepEqual( res, defaultConfig );
    } );
} );

describe( 'non-empty configurations', function() {
    it( 'should move deps to paths when necessary', function() {
        var res = normalize( {
            deps: {
                'test': 'test.js'
            }
        } );

        assert.deepEqual( res, {
            baseUrl: cwd,
            paths:   {
                'test': path.resolve( cwd, 'test.js' )
            },
            deps:    ['test'],
            shim:    {}
        } );
    } );

    it( 'should normalize shims into', function() {
        var res = normalize( {
            deps:  {
                'test': 'test.js'
            },
            shim:  {
                'mod1': {
                    deps:    ['jquery'],
                    exports: 'K'
                },
                'mod2': ['underscore', 'Modernizr']
            },
            paths: {
                'mod1':       'bower/mod1.js',
                'mode2':      'bower/mod2.js',
                'underscore': 'bower/underscore.js',
                'Modernizr':  'bower/modernizr.js'
            }
        } );

        assert.deepEqual( res, {
            baseUrl: cwd,
            paths:   {
                'test':       path.resolve( cwd, 'test.js' ),
                'mod1':       path.resolve( cwd, 'bower/mod1.js' ),
                'mode2':      path.resolve( cwd, 'bower/mod2.js' ),
                'underscore': path.resolve( cwd, 'bower/underscore.js' ),
                'Modernizr':  path.resolve( cwd, 'bower/modernizr.js' )
            },
            deps:    ['test'],
            shim:    {
                mod1: {
                    exports: 'K',
                    deps:    ['jquery']
                },
                mod2: {
                    deps: ['underscore', 'Modernizr']
                }
            }
        } );
    } );

    it( 'should correct for malformed entries', function() {
        var res = normalize( {
            baseUrl: 32,
            paths:   ['nothing'],
            deps:    {
                'test1': 'test.js'
            }
        } );

        assert.deepEqual( res, {
            baseUrl: cwd,
            paths:   {
                'test1': path.resolve( cwd, 'test.js' )
            },
            deps:    ['test1'],
            shim:    {}
        } )
    } )
} );
