const MongoClient = require('mongodb').MongoClient;
const Model = require('../lib/model');

class Test extends Model
{
    constructor( collection )
    {
        super( collection );
    }

    async get( ...args )
    {
        return super.get( ...args );
    }
}

async function test()
{
    const client = MongoClient( `mongodb://localhost:27017`, { useUnifiedTopology: true }); client.connect();
    const mongodb = client.db( 'mongo_model_databazka' );

    const test = new Test( mongodb.collection( 'testik' ));

    let new_entry = await test.create( null, { foo: 'bar' }, { lock: 10000 });

    console.log( new_entry );

    let entry = await test.get( 106, [], { lock: 10000, timeout: 1000 });
    let update = await test.update( 106, { foo: 'foobar' }, { key: entry.__key, timeout: 1000, unlock: true });

    console.log( update );

    let unlock = 0;//await test.unlock( 106, entry.__key );

    console.log( entry, entry.__key, unlock );
}

test();