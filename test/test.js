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
    try
    {
        const client = MongoClient( `mongodb://localhost:27017`, { useUnifiedTopology: true }); client.connect();
        const mongodb = client.db( 'mongo_model_databazka' );

        const test = new Test( mongodb.collection( 'testik' ));

        let new_entry = await test.create( null, { foo: 'bar', bar: 'foo' }, { lock: 10000 });

        console.log( new_entry );

        //let entry = await test.get( 106, [], { lock: 10000, timeout: 1000 });
        let entry = await test.get({ _id: 106 });
        let update = await test.update( 106, { foo: 'foobar' }, { key: entry.__key, timeout: 1000, unlock: true });

        console.log( update );

        let unlock = 0;//await test.unlock( 106, entry.__key );

        console.log( entry, entry.__key, unlock );
    }
    catch( e )
    {
        console.log( e );
    }
}

async function test_ref()
{
    const client = MongoClient( `mongodb://localhost:27017`, { useUnifiedTopology: true }); client.connect();
    const mongodb = client.db( 'milkstock' );

    const test = new Test( mongodb.collection( 'asks' ));

    //let ask = await test.get( 98059133911701 );

    //console.log( ask );
    
    const test2 = new Test( mongodb.collection( 'users' ));

    //let user = await test2.get( 97991820678043 );

    //console.log( require('util').inspect( user, { depth: Infinity, colors: true }));

    //let users = await test2.list();

    //console.log( require('util').inspect( users, { depth: Infinity, colors: true }));

    setTimeout(() =>
    {
        test2.get( 97991820678043 ).then( console.log );

        setTimeout(() =>
        {
            test2.get( 97991820678043 ).then( console.log )
        },
        200 );
    },
    200 );

    let multiusers = await Promise.all([ test2.get( 97991820678043 ), test2.get( 247886762495992 ), test2.get( 97991820678043 )]);

    console.log( require('util').inspect( multiusers, { depth: Infinity, colors: true }));

    for( let i = 0; i < 100; ++i )
    {
        //await test2.get( 97991820678043 );
    }
}

test();
//test_ref();