'use strict';

const EventEmitter = require('events');
const Aggregator = require('@liqd-js/aggregator');
const Normalize = require('@liqd-js/normalize')
const { Filter, Projection, UnderscoredFirst, ResolveReferences, CompileStringRE, EscapeREStringLatin } = require('./helpers');

const randomID = () => ( Date.now() % 90028800000 ) * 100000 + Math.floor( Math.random() * 100000 ); //( 1042 * 24 * 60 * 60 * 1000 )
const getLockTimeout = () => Date.now() * 1000;
const generateLockKey = ( lock_timeout = 10000 ) => ( Date.now() + lock_timeout ) * 1000 + Math.floor( Math.random() * 1000 );
const SLEEP = ms => new Promise( r => setTimeout( r( true ), ms ));
const NOOP = () => undefined;

const INCREMENT = Symbol('INCREMENT');

// TODO ulozit do weakmap podla databazy a kolekcie Model instance aby sme vedeli pouzit pri resolvovani referencii

module.exports = class Model extends EventEmitter
{
    #collection; #name; #options; #get_aggregator; #increment;

    get INCREMENT(){ return INCREMENT }
    static get INCREMENT(){ return INCREMENT }

    constructor( collection, options = {})
    {
        super();
        
        this.#collection = collection;
        this.#name = collection.s.namespace.collection;
        this.#options = options;
        this.#get_aggregator = new Aggregator( async( ids, ...args ) => 
        {
            return this.get( ids, ...args );
        });
    }

    async #maxID()
    {
        return this.#collection.aggregate([{ $group: { _id: null, max: { $max: '$_id'}}}]).toArray().then( a => a.length ? ( typeof a[0].max === 'number' ? a[0].max : NaN ) : 0 );
    }

    async #next( force = false )
    {
        if( !this.#increment || force )
        {
            this.#increment = Math.max(  await this.#maxID(), this.#increment || 0 );
        }

        if( isNaN( this.#increment ))
        {
            throw { code: 412, message: 'Couldn\'t autoincrement index for new entry of ' + this.constructor.name };
        }

        // TODO pridat vyplnanie medzier pri faile

        return this.#increment += 1;
    }

    async exist( id )
    {
        let filter = Filter( id );

        this.#collection.findOne( filter, { _id: 1 });
    }

    async create( id, data, options = {})
    {
        if( this.#options?.normalizer?.create?.schema )
        {
            try
            {
                data = Normalize( data, this.#options.normalizer.create.schema, this.#options.normalizer.create.options );
            }
            catch( err )
            {
                throw { code: 412, message: 'Couldn\'t create new entry of ' + this.constructor.name, args: { id, data, options }, normalizerErr: err }
            }
        }

        let insert, entry, now, key;

        while( true )
        {
            try
            {
                insert = await this.#collection.insertOne( entry =
                {
                    _id: id === INCREMENT ? await this.#next( now !== undefined ) : id ?? randomID(),
                    ...data, 
                    ...( options.lock ? { __model: { lock: key = generateLockKey( typeof options.lock === 'number' ? options.lock : undefined )}} : undefined )
                });
            }
            catch( err )
            {
                if( err.code === 11000 )
                {
                    if([ INCREMENT, undefined, null ].includes( id ) && err.keyValue.hasOwnProperty('_id') && Object.keys( err.keyValue ).length === 1 ){ continue }

                    throw { code: 409, message: 'Couldn\'t create new entry of ' + this.constructor.name + ', ' + require('util').inspect( err.keyValue ) + ' already exists', args: { id, data, options }}
                }

                throw { code: 500, message: 'Couldn\'t create new entry of ' + this.constructor.name, args: { id, data, options }, mongoErr: err }
            }

            break;
        }

        //if( insert.insertedCount !== 1 ){ throw { code: 500, message: 'Couldn\'t create new entry of ' + this.constructor.name, args: { id, data, options }, mongoErr: err}} // BROKEN ONF MONGODB 4.0.0 ?

        key && Object.defineProperty( entry, '__key', { writable: false, enumerable: false, value: key });
        delete entry.__model;

        this.#options.logger && this.#options.logger.log( 'create', this.#name, entry._id, entry ).catch( NOOP );

        if( !this.constructor.prototype.hasOwnProperty( 'create' ))
        {
            this.emit( 'create', entry );
        }

        return entry;
    }
    
    async get( id, properties, options = {}) // TODO option unlocked co prida podmienku ze nesmie byt locknuty
    {
        // TODO get for multiple ids

        let filter = Filter( id ), projection = Projection( properties ), entry, key, deadline = options.timeout ? Date.now() + options.timeout : Infinity;

        if( Array.isArray( id ))
        {
            if( options.lock ){ throw 'array getter with lock not implemented' }

            let entries = await this.#collection.find( filter, { projection }).toArray();

            await ResolveReferences( this.#collection.s.db, entries, { properties });

            let index = new Map( entries.map( e => [ e._id, e ]));

            return id.map( id => index.get( id ));
        }
        else if( !options.lock && filter.hasOwnProperty( '_id' ) && Object.keys( filter ).length === 1 )
        {
            entry = await this.#get_aggregator.call( filter._id, properties, options );

            delete entry?.__model;

            return entry || undefined;
        }
        else if( options.lock )
        {
            do
            {
                if( deadline < Infinity && deadline < Date.now() )
                {
                    throw { code: 408, message: 'Couldn\'t get entry of ' + this.constructor.name + ', request timeouted ' + require('util').inspect( filter ), args: { id, properties, options }}
                }

                entry = await this.#collection.findOneAndUpdate({ $and:
                [
                    filter,
                    { $or: [{ '__model.lock': { $exists: false }}, { '__model.lock': { $lt: getLockTimeout() }}]}
                ]},
                { $set: { '__model.lock': key = generateLockKey( typeof options.lock === 'number' ? options.lock : undefined )}},
                { projection })
                .then( r => r.value );

                if( !entry && !await this.#collection.findOne( filter, { _id: 1 }))
                {
                    break;
                }
            }
            while( !entry && await SLEEP( 100 ));
        }
        else
        {
            entry = await this.#collection.findOne( filter, { projection });
        }

        if( !entry )
        {
            throw { code: 404, message: 'Couldn\'t get entry of ' + this.constructor.name + ', entry not found ' + require('util').inspect( filter ), args: { id, properties, options }};
        }

        await ResolveReferences( this.#collection.s.db, entry, { properties });

        key && Object.defineProperty( entry, '__key', { writable: false, enumerable: false, value: key });
        delete entry.__model;

        return entry || undefined;;
    }
    
    async unlock( id, key )
    {
        return ( await this.#collection.updateOne({ ...Filter( id ), '__model.lock': key }, { $set: { '__model.lock': 0 }}))?.modifiedCount || 0;
    }

    async unlockMany( filter, key )
    {
        // TODO handle filter array

        return ( await this.#collection.updateMany({ ...Filter( filter ), '__model.lock': key }, { $set: { '__model.lock': 0 }}))?.modifiedCount || 0;
    }

    async update( id, modification, options = {})
    {
        if( this.#options?.normalizer?.update?.schema ) // TODO normalizer treba lepsie pouzivat ked mame rozne typy modifikatorov alebo subpath
        {
            try
            {
                modification = Normalize( modification, this.#options.normalizer.update.schema, this.#options.normalizer.update.options ); // TODO lepsie
            }
            catch( err )
            {
                throw { code: 412, message: 'Couldn\'t update entry of ' + this.constructor.name, args: { id, modification, options }, normalizerErr: err }
            }
        }

        let filter = Filter( id ), entry, key, deadline = options.timeout ? Date.now() + options.timeout : Infinity;

        if( !Object.keys( modification ).find( k => k[0] === '$' ))
        {
            modification = { $set: modification };
        }

        modification.$set || ( modification.$set = {});
        options.unlock && ( modification.$set['__model.lock'] = 0 );

        do
        {
            if( deadline < Infinity && deadline < Date.now() )
            {
                throw { code: 408, message: 'Couldn\'t update entry of ' + this.constructor.name + ', request timeouted ' + require('util').inspect( filter ), args: { id, modification, options }}
            }

            entry = await this.#collection.findOneAndUpdate({ $and:
            [
                filter,
                { $or: [{ '__model.lock': { $exists: false }}, { '__model.lock': { $lt: getLockTimeout()}}, { '__model.lock': options.key }]}
            ]}
            , modification
            , options.upsert ? { upsert: true } : undefined )
            .then( r => r.value );

            if( !entry && !await this.#collection.findOne( filter, { _id: 1 }))
            {
                break;
                //throw { code: 404, message: 'Couldn\'t get entry of ' + this.constructor.name + ', entry not found ' + require('util').inspect( filter ), args: { id, modification, options }};
            }
        }
        while( !entry && await SLEEP( 100 ));

        //let id = update.value._id; delete update.value._id;

        //this.#options.logger && this.#options.logger.log( 'update', this.#name, id, update.value ).catch( NOOP );

        //this.#collection.updateOne( filter, modification );

        /*if( !this.constructor.prototype.hasOwnProperty( 'update' ))
        {
            this.emit( 'updated', {});
        }*/

        return !!entry;
    }

    async updateMany( filter, modification, options = {})
    {
        //let filter = Filter( id );

        // TODO lock
        
        this.#collection.updateMany( filter, modification, options.upsert ? { upsert: true } : undefined );
    }

    async delete( id, options = {})
    {
        let filter = Filter( id );

        await this.#collection.deleteOne( filter );

        return true; // TODO check if deleted

        /*if( !this.constructor.prototype.hasOwnProperty( 'delete' ))
        {
            this.emit( 'deleted', {});
        }*/
    }

    async deleteMany( filter, options = {})
    {
        await this.#collection.deleteMany   ( filter );

        return true;
    }

    async list( query = {}, properties = undefined )
    {
        if( query.after || query.before )
        {
            /*
            let id = view.after || view.before;
            let projection = {};
            if( view.order )
            {
                Object.keys( view.order ).forEach( c => projection[ c ] = 1 );
            }
            if( !projection.hasOwnProperty( '_id' ) ){ projection._id = 1;  }
            let values = await this.#DB.collection( this.#collection ).findOne( { _id: id }, { projection } );
            let conditions = Object.keys( projection );
            let sort_condition = { $or: [] };
            for( let k = 0; k < conditions.length; k++ )
            {
                let part = {};
                for( let i = 0; i < conditions.length - k; i++ )
                {
                    if( view.before )
                    {
                        if( i === ( conditions.length - k -1 ))
                        {
                            part[ conditions[i] ] = { [ ( view.order.hasOwnProperty( conditions[i] ) &&  view.order[ conditions[i] ] === -1 ? '$gt' : '$lt' ) ] : values[ conditions[i] ]};
                        }
                        else
                        {
                            part[ conditions[i] ] = { [ ( view.order.hasOwnProperty( conditions[i] ) &&  view.order[ conditions[i] ] === -1 ? '$gte' : '$lte' ) ] : values[ conditions[i] ]};
                        }
                    }
                    else
                    {
                        if( i === ( conditions.length - k -1 ))
                        {
                            part[ conditions[i] ] = { [ ( view.order.hasOwnProperty( conditions[i] ) &&  view.order[ conditions[i] ] === -1 ? '$lt' : '$gt' ) ] : values[ conditions[i] ]};
                        }
                        else
                        {
                            part[ conditions[i] ] = { [ ( view.order.hasOwnProperty( conditions[i] ) &&  view.order[ conditions[i] ] === -1 ? '$lte' : '$gte' ) ] : values[ conditions[i] ]};
                        }
                    }
                }
                
                sort_condition.$or.push( part );
            }
            if( view.before )
            {
                for( let column in view.order )
                {
                    view.order[ column ] = ( view.order[ column ] === 1 ? -1 : 1 );
                }
                if( !view.order.hasOwnProperty( '_id' ) ){ view.order._id = -1; }
            }
            let results = await this.#DB.collection( this.#collection )
                .find( { $and: [ ( Array.isArray( filter ) ? { $or: filter } : filter ), sort_condition ] }, { projection: view.projection || {} } )
                .sort( view.order || { _id : 1 } )
                .limit( view.limit || 0 )
                .toArray();
            return ( view.before ? results.reverse() : results );
            */
        }
        else
        {
            if( query.filter )
            {
                CompileStringRE( query.filter );
            }

            let cursor = this.#collection.find( Array.isArray( query.filter ) ? { $or: query.filter } : query.filter, { projection: Projection( properties )});

            query.order && ( cursor = cursor.sort( query.order ));
            query.offset && ( cursor = cursor.skip( query.offset ));
            query.limit && ( cursor = cursor.limit( query.limit ));

            let list = await cursor.toArray();

            await ResolveReferences( this.#collection.s.db, list, { properties }); // TODO references

            return list;
        }
    }

    async aggregate( pipeline, options )
    {
        return this.#collection.aggregate( pipeline, options ).toArray();
    }

    async search( query = {}, properties = undefined )
    {
        let pipeline = [], decay = 1, decay_start;

        if( query.decay )
        {
            decay_start = query.after?.__decay_start ?? query.after?.decay_start ?? query.decay.start ?? '$$NOW';

            if( typeof decay_start === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test( decay_start ))
            {
                decay_start = new Date( decay_start );
            }

            decay = { $pow: [ 2, { $divide: [{ $subtract: [ '$' + ( query.decay.property || '__model.created' ), decay_start ]}, query.decay.halftime ]}]};
        }

        if( query.filter )
        {
            pipeline.push({ $match: CompileStringRE( query.filter )});
        }

        if( query.string )
        {
            let words = query.string.trim().split(/\s+/), matchRE = new RegExp( '(' + words.map( w => EscapeREStringLatin( w )).join('|') + ')', 'i' );

            pipeline.push({ $match: { $or: Object.keys( query.properties ).map( p => ({ [p]: matchRE }))}});

            if( words.length === 1 )
            {
                if( query.decay )
                {
                    pipeline.push({ $project: { decay_start: { $toDouble: decay_start }, score: { $multiply: [ decay, { $add: Object.keys( query.properties ).map( p => ({ $cond: [{ $regexMatch: { input: '$' + p, regex: matchRE }}, query.properties[p], 0 ]}))}]}}});
                }
                else
                {
                    pipeline.push({ $project: { score: { $add: Object.keys( query.properties ).map( p => ({ $cond: [{ $regexMatch: { input: '$' + p, regex: matchRE }}, query.properties[p], 0 ]}))}}});
                }
            }
            else
            {
                let $project = query.decay ? { decay } : {}, $match = {}, i = 0;

                for( let wordRE of words.map( w => new RegExp( EscapeREStringLatin( w ), 'i' )))
                {
                    $project['score_'+(++i)] = { $add: Object.keys( query.properties ).map( p => ({ $cond: [{ $regexMatch: { input: '$' + p, regex: wordRE }}, query.properties[p], 0 ]}))};
                    $match['score_'+i] = { $gt: 0 };
                }

                pipeline.push({ $project }, { $match });

                if( query.decay )
                {
                    pipeline.push({ $project: { decay_start: { $toDouble: decay_start }, score: { $multiply: [ '$decay', { $add: words.map(( _, i ) => '$score_'+( i+1 ))}]}}});
                }
                else
                {
                    pipeline.push({ $project: { score: { $add: words.map(( _, i ) => '$score_'+( i+1 ))}}});
                }
            }
        }
        else if( query.decay )
        {
            pipeline.push({ $project: { score: decay, decay_start: { $toDouble: decay_start }}});
        }

        if( query.after )
        {
            pipeline.push({ $match: { $or: 
            [
                { score: { $lt: query.after.__score ?? query.after.score }},
                { score: query.after.__score ?? query.after.score, _id: { $gt: query.after._id ?? query.after.id }},  //TODO musime si poslat $$NOW ako __decay_start
            ]}});
        }

        pipeline.push({ $sort: { score: -1, _id: 1 }});

        if( query.limit )
        {
            pipeline.push({ $limit: query.limit });
        }

        //console.log( require('util').inspect( pipeline, { depth: Infinity }).replace(/\s*\n\s*/g, '' ));

        let ids = await this.#collection.aggregate( pipeline ).toArray(), entries = [];

        //console.log( ids );

        if( ids.length )
        {
            let ID2Score = new Map( ids.map( e => [ e._id, e.score ]));

            entries = await this.get( ids.map( e => e._id ), properties );
            entries.forEach( e => 
            {
                e.__score = ID2Score.get( e._id );
                query.decay && ( e.__decay_start = decay_start === '$$NOW' || decay_start instanceof Date ? new Date( ids[0].decay_start ) : ids[0].decay_start );
            });
        }

        return entries;
    }

    async logs( id )
    {

    }
}