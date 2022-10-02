# dragonfly-redis-prisma-cache
A Cache middleware for dragonfly (faster then redis), which still can be used with redis.

# Install Package
```
npm i Tomato6966/dragonfly-redis-prisma-cache
```

# Use Package
```js
import { PrismaClient } from '@prisma/client'
import { prismaDragonflyRedisCache } from 'prisma-cache-middleware';

const prisma = new PrismaClient();

prisma.$use(prismaDragonflyRedisCache({
    redisOptions:{
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
    useAllModels: true,
    defaultCacheActions: [ "findUnique", "findFirst", "findMany", "count", "aggregate", "groupBy", "findRaw", "aggregateRaw" ]
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

## Building and formatting
```
npm run build
npm run lint
npm run format
```
