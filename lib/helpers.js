module.exports.Filter = function Filter( filter )
{
    if( Array.isArray( filter ))
    {
        return { _id: { $in: filter }}; // TODO poriesit aj ked filter je array objektov
    }
    else if( typeof filter === 'object' )
    {
        let multifilter = {};

        for( let property in filter )
        {
            multifilter[ property ] = Array.isArray( filter[ property ]) ? { $in: filter[ property ]} : filter[ property ];
        }

        return multifilter;
    }
    
    return { _id: filter };
}

module.exports.Projection = function Projection( properties = [])
{
    let projection = {};

    properties = properties.filter( p => !/\$\$/.test( p ));

    for( let property of properties )
    {
        ( property[0] !== '!' ) ? ( projection[ property ] = 1 ) : ( projection[ property.substr( 1 )] = 0 );
    }

    return projection;
}

module.exports.UnderscoredFirst = function UnderscoredFirst( obj )
{
    const sorted = {};

    for( let key of Object.keys( obj ).filter( k => k[0] === '_' ))
    {
        sorted[ key ] = obj[ key ];
    }

    for( let key of Object.keys( obj ).filter( k => k[0] !== '_' ))
    {
        sorted[ key ] = obj[ key ];
    }

    return sorted;
}

module.exports.Diff = function Diff( original, current, prefix = '', diff = {})
{
    for( let key in current )
    {
        if( JSON.stringify( current[key] ) !== JSON.stringify( original[key] ))
        {
            if( typeof current[key] === 'object' && typeof original[key] === 'object' && !Array.isArray( current[key] ) && !Array.isArray( original[key] ))
            {
                Diff(  original[key], current[key], prefix + key + '.', diff );
            }
            else
            {
                diff[ prefix + key ] = current[ key ];
            }
        }
    }

    return diff;
}

class MongoModelReference
{
    #collection; #id; #properties; #resolved = false;

    constructor( collection, id, properties )
    {
        this.#collection = collection;
        this.#id = id;
        this.#properties = properties;
    }

    get $ref(){ return this.#collection }
    get $id(){ return this.#id }
    get $resolved(){ return this.#resolved }
    get $properties(){ return this.#properties } // TODO zmenit na symboly aby som to nepouzil mimo

    resolve( obj )
    {
        this.#resolved = true;

        for( let key in obj )
        {
            this[key] = obj[key];
        }
    }
}

const ALPHA_NUM_CHAR_RE = /^[A-Za-z0-9]+$/;

function escapeRegExp( re )
{
	return (''+re).split('').map( c => ALPHA_NUM_CHAR_RE.test(c) ? c : ( c === "\\000" ? "\\000" : "\\" + c )).join('');
}

function findReferences( obj, properties = [], references = new Map(), parent, key, path = [])
{
    if( obj && typeof obj === 'object' )
    {
        if( Array.isArray( obj ))
        {
            for( let i = 0; i < obj.length; ++i )
            {
                if( obj && typeof obj === 'object' )
                {
                    findReferences( obj[i], properties, references, obj, i, path.length ? [ ...path, i ] : undefined ); // TODO mozno pre pole itemov spravit foreach findReferences
                }
            }
        }         
        else if( obj.constructor.name === 'DBRef' )
        {
            let collection, reference, reference_properties = [], properties_prefix;

            if( properties.length )
            {
                reference_properties = properties.filter( p => ( properties_prefix = new RegExp( '((?<=^)|(?<=^!))' + escapeRegExp( path.join('.')) + '.' )).test( p )).map( p => p.replace( properties_prefix, '' ));
            }

            ( collection = references.get( obj.namespace )) || references.set( obj.namespace, collection = new Map());
            ( reference = collection.get( obj.oid )) || collection.set( obj.oid, reference = new MongoModelReference( obj.namespace, obj.oid, reference_properties )); // TODO vyrobit referenciu zvlast pre rozne properties

            parent[key] = reference;
        }
        else
        {
            for( let [ key, value ] of Object.entries( obj ))
            {
                if( value && typeof value === 'object' )
                {
                    findReferences( value, properties, references, obj, key, [ ...path, ( value.constructor.name === 'DBRef' || value instanceof MongoModelReference ? '$$' : '' ) + key ]);
                }
            }
        }
    }

    return references;
}

const Aggregator = require('@liqd-js/aggregator');
const Aggregators = new WeakMap();

module.exports.ResolveReferences = async function( db, obj, options = {})
{
    let resolvers;  // TODO aggregator pre db a collection

    do
    {
        resolvers = [];

        let found_references = findReferences( obj, options.properties );

        for( let [ collection, references ] of found_references.entries())
        {
            let aggregators, aggregator, coll = db.collection( collection );

            ( aggregators = Aggregators.get( db )) || ( Aggregators.set( db, aggregators = new Map() ));
            ( aggregator = aggregators.get( collection )) || ( aggregators.set( collection, aggregator = new Aggregator( async( ids, ...args ) => 
            {
                let entries = await coll.find({ _id: { $in: ids }}, { projection: module.exports.Projection( args[0] )}).toArray(); // TODO radsej pouzit getter
                entries.forEach( e => delete e.__model );                
                let index = new Map( entries.map( e => [ e._id, e ]));

                return ids.map( id => index.get( id ));
            })));
                
            for( let reference of references.values() )
            {
                if( !reference.$resolved )
                {
                    resolvers.push( aggregator.call( reference.$id, reference.$properties ).then( e => reference.resolve( e )));
                }
            }
        }

        if( resolvers.length ){ await Promise.all( resolvers )}
    }
    while( resolvers.length )

    return obj; 
}