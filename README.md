# dragonfly-redis-prisma-cache
A Cache middleware for dragonfly (faster then redis), which still can be used with redis.

# Install Package
```
npm i Tomato6966/dragonfly-redis-prisma-cache
```

# Why should u use this?

First you should always cache a database for GET-QUERY REQUESTS.
This way you reduce traffic on a database.
Prisma is very great as this way you can use postgresql / mongodb / mysql... with the same wrapper! and still are able to use this cache with all dbs!

It's the most optimal, when beeing used with [dragonfly](https://github.com/dragonflydb/dragonfly)
Because dragonfly is like redis, yet it has multithreading and can handle hundred of thousands requests at the same time!

This package is better then other cache wrappers cause it invalidates only thigns related to what you change!

You can still use it with regular redis tho.

## How to install and use dragonfly

1. download it
```
wget https://github.com/dragonflydb/dragonfly/releases/latest/download/dragonfly-x86_64.tar.gz && tar -xvzf dragonfly-x86_64.tar.gz && rm dragonfly-x86_64.tar.gz
```
2. start it (host, port, max memory in bytes, auto storage in a single file with autosavings every 30mins)
```
./dragonfly-x86_64 --logtostderr --requirepass=youshallnotpass --bind localhost --port 5000 --hz=10 --save_schedule "*:30" --maxmemory 4294967296 --dbfilename dump.rdb
```
3. you can paste all of that inside a "startdragonfly.sh" file and start that file via pm2 / screen etc.
```
echo "./dragonfly-x86_64 --logtostderr --requirepass=youshallnotpass --bind localhost --port 5000 --hz=10 --save_schedule "*:30" --maxmemory 4294967296 --dbfilename dump.rdb" > startdragonfly.sh
chmod +rwx startdragonfly.sh
# e.g. with pm2
pm2 start --name dragonflycache ./startdragonfly.sh
```

# Use Package
```js
import { PrismaClient } from '@prisma/client'
import { prismaDragonflyRedisCache } from 'dragonfly-redis-prisma-cache';

const prisma = new PrismaClient();

prisma.$use(prismaDragonflyRedisCache({
    storageOptions:{
        // connection hostname/ipaddress
        host: "localhost",
        // Port for the dragonfly instance
        port: 6379,
        // your password don't provide it if not needed
        password: "youshallnotpass",
        // when to cancel the requests after X milli-seconds
        timeout: 2000,
        /** If undefined | <= 0 then no Pool will be used */
        min_conn: 100,
        // dragonfly can handle hundred of thousands connections at once
        max_conn: 1000,
        //  tls: {
        //    key: Buffer.from("key_string"),
        //    cert: Buffer.from("cert_string"),
        //  };
    },
    useAllModels: true, //overwrites toCache
    defaultCacheActions: [ "findUnique", "findFirst", "findMany", "count", "aggregate", "groupBy", "findRaw", "aggregateRaw" ],
    defaultTTL: 0, // amount of ttl for on default
    toCache: [
        {                      
            model: 'Users',                
            actions: ['findFirst', "findUnique", "count"],           
            ttl: 60,                       
            keyPrefix: 'usrs'             
        },
        {
            model: 'Users',
            actions: ['findFirst', "findUnique", "count"],
        }
    ]
}));

export default prisma;
```
example how i do it:

```js
const { getRedisDataOfURL, prismaDragonflyRedisCache } = require("dragonfly-redis-prisma-cache");
prisma.$use(prismaDragonflyRedisCache({
    storageOptions: {
        ...(getRedisDataOfURL(process.env.DATABASECACHECONNECTURL)),
        min_conn: 100,
        max_conn: 1000,
    },
    useAllModels: true,
    defaultCacheActions: [ "findUnique", "findFirst", "findMany", "count", "aggregate", "groupBy", "findRaw", "aggregateRaw" ],
}));
```

### Devnote: Building and formatting
```
npm run build
npm run lint
npm run format
```
