'use strict';

module.exports = class Model
{
    #collection; #options;

    constructor( collection, options = {})
    {
        this.#collection = collection;
        this.#options = options;
    }

    async create( id, data )
    {
        let now = Date.now(); id = id || RandomID(); // TODO timestamp preserve original

        data = UnderscoredFirst({ _id: id, ...data, _timestamps: { created: now, updated: now }});

        let insert = await this.#collection.insertOne( data ).catch( err =>
            {
                console.log( err );
    
                if( err.code === 11000 ){ throw { code: 409, message: 'conflict' }}
    
                throw { code: 500, message: 'error' }
            });
    
            if( insert.insertedCount !== 1 ){ throw { code: 500, message: 'error' }}
    
            this.#ctx.logger && this.#ctx.logger.log( 'create', this.#name, id, data ).catch( NOOP );
    
            return id;
    }

    async update( id, modification )
    {
        let filter = Filter( id );

        this.#collection.updateOne( filter, modification );
    }

    async updateMany( filter, modification )
    {
        let filter = Filter( id );
        
        this.#collection.updateMany( filter, modification );
    }

    async delete( id )
    {

    }

    async deleteMany( id )
    {

    }
    
    async get( id, properties )
    {

    }

    async list( query, properties )
    {

    }

    async logs( id )
    {

    }
}