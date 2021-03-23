module.exports.Filter = function Filter( filter )
{
    if( Array.isArray( filter ))
    {
        return { _id: { $in: filter }};
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