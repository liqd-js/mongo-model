const assert = require('node:assert');
const MongoModel = require( '..' );

let DB, PREFIX = 'mongo_model_', NOOP = () => undefined;

const approximately = ( value, desired, epsilon ) => desired - epsilon < value && value < desired + epsilon;

describe( 'setup', () =>
{
    it( 'should connect to mongoDB', async() =>
    {
        client = new ( require('mongodb').MongoClient )( 'mongodb://webergency-sandbox:HJpEvXRhFGVWK249@localhost:27017?authMechanism=DEFAULT', { useUnifiedTopology: true });
        
        await client.connect();

        DB = client.db( 'webergency_sandbox' );
    })
    .timeout( 5000 );

    it( 'should remove all collections', async() =>
    {
        await DB.collection( PREFIX + 'companies' ).drop().catch( NOOP );
        await DB.collection( PREFIX + 'employees' ).drop().catch( NOOP );
    })
    .timeout( 5000 );
});

describe( 'basic model', () =>
{
    let BasicModel, companies, employees;
    
    it( 'should define model', () => 
    {
        BasicModel = class BasicModel extends MongoModel
        {
            constructor( collection, options )
            {
                super( collection, options );
            }
        }
    });

    it( 'should instantiate models', () => 
    {
        companies = new BasicModel( DB.collection( PREFIX + 'companies' ));
        employees = new BasicModel( DB.collection( PREFIX + 'employees' ));
    });

    it( 'should not find entry', async() =>
    {
        let entry = await companies.get( 1 );

        assert.equal( entry, undefined, 'entry should be undefined' );
    });

    it( 'should create entry', async() =>
    {
        const data = { name: 'ACME' };

        let entry = await companies.create( 1, data );

        assert.deepStrictEqual( entry, { _id: 1, ...data }, 'created entry missmatch' );

        entry = await companies.get( 1 );

        assert.deepStrictEqual( entry, { _id: 1, ...data }, 'fetched entry missmatch' );
    });

    it( 'should create entry with increment', async() =>
    {
        const data = { name: 'APPLE' };

        let entry = await companies.create( companies.INCREMENT, data );

        assert.deepStrictEqual( entry, { _id: 2, ...data }, 'created entry missmatch' );

        entry = await companies.get( 2 );

        assert.deepStrictEqual( entry, { _id: 2, ...data }, 'fetched entry missmatch' );
    });

    it( 'should list all entries', async() =>
    {
        let entries = await companies.list({ order: { _id: -1 }});
        
        assert.equal( entries.length, 2, 'fetched entries count missmatch' );
        assert.deepStrictEqual( entries.map( e => e._id ), [ 2, 1 ], 'fetched entries missmatch' );
    });

    it( 'should lock/unlock entry', async() =>
    {
        let entry = await companies.get( 1, undefined, { lock: 2000 });

        assert.ok( entry.__key, 'entry key missing' );
        assert.equal( entry._id, 1, 'fetched entry missmatch' );

        await companies.unlock( 1, entry.__key );
    });

    it( 'should prevent accessing locked entry', async() =>
    {
        let entry = await companies.get( 1, undefined, { lock: 2000 }), start = Date.now();
        let locked_entry = await companies.get( 1, undefined, { lock: 2000 });

        assert.ok( approximately(  Date.now() - start, 2000, 250 ), 'entry was not locked' );

        await companies.unlock( 1, locked_entry.__key );
    })
    .timeout( 10000 );

    it( 'should not update locked entry', async() =>
    {
        let entry = await companies.get( 1, undefined, { lock: 5000 }), start = Date.now();
        let status = await companies.update( 1, { name: 'ACME inc.' }, { timeout: 2000 }).catch( e => e );

        assert.equal( status.code, 408, 'entry was not protected' );
    
        await companies.unlock( 1, entry.__key );

        entry = await companies.get( 1 );

        assert.equal( entry.name, 'ACME', 'entry was updated' );
    })
    .timeout( 10000 );

});

describe( 'cleanup', () =>
{
    it( 'should remove all collections', async() =>
    {
        await DB.collection( PREFIX + 'companies' ).drop().catch( NOOP );
        await DB.collection( PREFIX + 'employees' ).drop().catch( NOOP );
    })
    .timeout( 5000 );
});