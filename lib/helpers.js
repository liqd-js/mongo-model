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
    #collection; #id; #resolved = false;

    constructor( collection, id )
    {
        this.#collection = collection;
        this.#id = id;
    }

    get $ref(){ return this.#collection }
    get $id(){ return this.#id }
    get $resolved(){ return this.#resolved }

    resolve( obj )
    {
        this.#resolved = true;

        for( let key in obj )
        {
            this[key] = obj[key];
        }
    }
}

function findReferences( obj, references = new Map(), parent, key )
{
    if( obj && typeof obj === 'object' )
    {
        if( Array.isArray( obj ))
        {
            for( let i = 0; i < obj.length; ++i )
            {
                if( obj && typeof obj === 'object' )
                {
                    findReferences( obj[i], references, obj, i );
                }
            }
        }         
        else if( obj.constructor.name === 'DBRef' )
        {
            let collection, reference; 
            
            ( collection = references.get( obj.namespace )) || references.set( obj.namespace, collection = new Map());
            ( reference = collection.get( obj.oid )) || collection.set( obj.oid, reference = new MongoModelReference( obj.namespace, obj.oid ));

            parent[key] = reference;
        }
        else
        {
            for( let [ key, value ] of Object.entries( obj ))
            {
                if( value && typeof value === 'object' )
                {
                    findReferences( value, references, obj, key );
                }
            }
        }
    }

    return references;
}

module.exports.ResolveReferences = async function( db, obj, options = {})
{
    let resolved;

    do
    {
        resolved = false;

        let found_references = findReferences( obj );

        for( let [ collection, references ] of found_references.entries())
        {
            let coll = db.collection( collection );
                
            for( let reference of references.values() )
            {
                if( !reference.$resolved )
                {
                    resolved = true;

                    reference.resolve( await coll.findOne({ _id: reference.$id }));
                }
            }
        }
    }
    while( resolved )

    return obj; 
}