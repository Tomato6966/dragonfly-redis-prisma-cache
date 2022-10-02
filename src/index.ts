import { TedisPool, Tedis } from 'tedis';

export interface CacheOptions {
    /** Storage Options from Redis */
    storageOptions: {
        /** Hostname / Domain / IpAddress */
        host?: string;
        /** POrt of the Host */
        port?: number;
        /** Password of the host */
        password?: string;
        /** Timeout of the host when to stop the connection */
        timeout?: number;
        /** If undefined | <= 0 then no Pool will be used */
        min_conn?: number;
        /** Max connections for a pool */
        max_conn?: number;
        /** If tls is used for authentication. */
        tls?: {
          key: Buffer;
          cert: Buffer;
        };
    }
    /** IF I should cache all Models */
    useAllModels: boolean;
    /** All Query-Actions to use on default. it will cache if the query action is inside of this or inside of the correct toCache Element */
    defaultCacheActions?: string[];
    /** If it should use a ttl on default if the cache Action does not have a ttl / if useAllModels == true */
    defaultTTL?: number;
    /** If there should be debug logs */
    debug?: boolean;
    /** All cache elements, if you don't wanna use useALlModels and defaultCacheActions */
    toCache: {
        /** all models to use () */
        model: string,
        /** all actions to use the cache on */
        actions: string[],
        /** Time to live in seconds */
        ttl?: number,
        /** Prefix for the cache key */
        prefix?: string
    }[]
}

export type MiddlewareParameters = {
    model?: string;
    action: string;
    args: any;
    dataPath: string[];
    runInTransaction: boolean;
}
export const defaultMutationMethods = [
    "create",
    "createMany",
    "update",
    "updateMany",
    "upsert",
    "delete",
    "deleteMany",
    "executeRawUnsafe",
];

class prismaDragonflyRedisCacheMiddleware {
    private client: TedisPool | Tedis;
    private isPool: boolean;
    private defaultCacheActions: string[];
    private defaultTTL: number;
    private useAllModels: boolean;
    private toCache: {
        model: string,
        actions: string[],
        ttl?: number,
        prefix?: string
    }[];
    private debug: boolean;
    constructor(options: CacheOptions){

        validate(options)
        if(!options || (!options.toCache && !options.useAllModels) || !options.storageOptions) throw new SyntaxError("Something went wrong, not all options provided..");
        this.debug = options?.debug ?? false;
        this.toCache = options?.toCache ?? [];
        this.defaultTTL = options?.defaultTTL ?? 0;
        this.defaultCacheActions = options.defaultCacheActions ?? [];
        this.useAllModels = options.useAllModels ?? !options?.toCache?.length ? true : false;
        this.isPool = !!(options?.storageOptions?.min_conn && options.storageOptions.min_conn >= 1)
        if(!this.isPool) {
            delete options.storageOptions.min_conn;
            delete options.storageOptions.max_conn;
        } else {
            // @ts-ignore
            if(!options.storageOptions?.max_conn) options.storageOptions.max_conn = options.storageOptions.min_conn + 1; else if(options.storageOptions?.max_conn <= options.storageOptions.min_conn) options.storageOptions.max_conn = options.storageOptions.min_conn + 1;
        }
        this.client = this.isPool ? new TedisPool(options.storageOptions!) : new Tedis(options.storageOptions);
    }

    public handle = async (params: MiddlewareParameters, next: (params: MiddlewareParameters) => Promise<any>) => { 
        let result: any = null;
        const instance = (this.useAllModels && this.defaultCacheActions.includes(params.action)) || this.toCache?.find?.(instance => instance.model === params.model && (this.defaultCacheActions.includes(params.action) || instance.actions.includes(params.action)))
        if(instance){
            const data = typeof instance === "object" ? instance : { model: params.model, ttl: this.defaultTTL, prefix: "" };

            if(!data.ttl && this.defaultTTL > 0) data.ttl = this.defaultTTL;
            
            const cacheKey = `${data.prefix ? `${data.prefix}-`: ``}${params.model}:${params.action}:${JSON.stringify(params.args)}`;
            // @ts-ignore
            const tedis = this.isPool ? await this.client.getTedis() : this.client;
            const findCache = await tedis.get(cacheKey);

            if(findCache) {
                try {
                    result = JSON.parse(findCache);
                    if(this.debug) console.log(`[Dragonfly-Redis-Prisma-Cache] ${params.model}.${params.action}() received data from Cache`);    
                } catch(e) {
                    console.error(e);
                }
            }
            else {
                // using stringified results, because that way it uses PPC2 from dragonfly to save 54% storage space
                result = await next(params);
                console.log("[Dragonfly-Redis-Prisma-Cache] Found something from the db and now storing it in:", cacheKey)
                if(data.ttl) {
                    await tedis.set(cacheKey, JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)), 'EX', data.ttl)
                } else {
                    await tedis.set(cacheKey, JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)))
                }
            }
            // @ts-ignore
            if(this.isPool) await this.client.putTedis(tedis);
        } else if(this.debug) console.log(`[Dragonfly-Redis-Prisma-Cache] Could not find instance for ${params.model}`)

        // not cached
        if(!result) {
            result = await next(params);
        }
        
        // delete everything from cache again...
        if (defaultMutationMethods.includes(params.action)) {
            // @ts-ignore
            const tedis = this.isPool ? await this.client.getTedis() : this.client;
            const keysData = await tedis.keys(`*${params.model}:*`);
            let keys = [];
            if(params.args.where) {
                const filtered = keysData.filter((k:string) => k.includes(JSON.stringify(params.args.where)))
                keys = filtered.length ? filtered : keysData;
                console.log(keysData.length, filtered.length);
            }
            for(const key of keys) await tedis.del(key); 
            // @ts-ignore
            if(this.isPool) await this.client.putTedis(tedis);
            if(this.debug) console.log(`[Dragonfly-Redis-Prisma-Cache] Invalidated ${keys.length} Keys after a mutationAction`)
        }
        return result;
    }
}

function validate(options:CacheOptions) {
    if(!options || typeof options !== "object") throw new SyntaxError("no valid cacheOptions provided")
    if(typeof options.useAllModels !== "undefined" && typeof options.useAllModels !== "boolean") throw new SyntaxError("option useAllModels was not as a boolean provided");
    if(options.toCache && !Array.isArray(options.toCache)) throw new SyntaxError("No option toCache was provided / option toCache is not a valid Array");
    if(!options.toCache && !options.useAllModels) throw new SyntaxError("No toCache and no useAllModels provided..")
    if(!options.defaultCacheActions || !Array.isArray(options.defaultCacheActions)) throw new SyntaxError("No option defaultCacheActions was provided / option defaultCacheActions is not a valid Array");
    if(options.defaultTTL && typeof options.defaultTTL !== "number") throw new SyntaxError("Option defaultTTL provided but its not a number")
    if(options.defaultTTL && options.defaultTTL <= 0) throw new SyntaxError("Optuion defaultTTL provided but its smaller or equal to 0");
    if(options.debug && typeof options.debug !== "boolean") throw new SyntaxError("Option debug provided which is not a boolean");
    return true;
}

export function prismaDragonflyRedisCache(options: CacheOptions) {
    const newCache = new prismaDragonflyRedisCacheMiddleware(options);
    return newCache.handle;
}
/**
 * extract redis options of a redis connect uri. e.g: "redis://username:password@hostname:port"
 * @param str 
 * @returns  object for redis authentication
 */
export function getRedisDataOfURL (str:string) { // @ts-ignore
    const [ username, [password, host], port ] = str.replace("redis://", "").split(":").map((x:string) => x.includes("@") ? x.split("@") : x);
    return { username, password, host, port };
}
