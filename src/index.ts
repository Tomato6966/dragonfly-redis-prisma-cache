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
    /** All cache elements, if you don't wanna use useALlModels and defaultCacheActiosn*/
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

class prismaDragonflyRedisCacheMiddleware <Prisma> {
    public client!: TedisPool | Tedis;
    public isPool!: boolean;
    public defaultCacheActions!: string[];
    public defaultTTL!: number;
    public useAllModels!: boolean;
    public toCache!: {
        model: string,
        actions: string[],
        ttl?: number,
        prefix?: string
    }[];

    constructor(options: CacheOptions){
        validate(options)
        bind(this);
        if(!options || (!options.toCache && !options.useAllModels) || !options.storageOptions) return;
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
        console.log("cache initiated")
    }

    public handle = async (params: MiddlewareParameters, next: (params: MiddlewareParameters) => Promise<any>) => { 
        let result: any = null;
        console.log(this)
        console.log(this.useAllModels, this.defaultCacheActions.includes(params.action), params.action, params.model)
        const instance = (this.useAllModels && this.defaultCacheActions.includes(params.action)) || this.toCache?.find?.(instance => instance.model === params.model && (this.defaultCacheActions.includes(params.action) || instance.actions.includes(params.action)))
        if(instance){
            const data = typeof instance === "object" ? instance : { model: params.model, ttl: this.defaultTTL, prefix: "" };

            if(!data.ttl && this.defaultTTL > 0) data.ttl = this.defaultTTL;
            
            const cacheKey = `${data.prefix ? `${data.prefix}-`: ``}${params.model}:${params.action}:${JSON.stringify(params.args)}`;
            // @ts-ignore
            const tedis = this.isPool ? await this.client.getTedis() : this.client;
            const findCache = await tedis.get(cacheKey);

            if(findCache) {
                console.log("found something from the cache")
                result = JSON.parse(findCache);
            }
            else {
                // using stringified results, because that way it uses PPC2 from dragonfly to save 54% storage space
                result = await next(params);
                console.log("found something from the db: ", cacheKey)
                if(data.ttl) {
                    await tedis.set(cacheKey, JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)), 'EX', data.ttl)
                } else {
                    await tedis.set(cacheKey, JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)))
                }
            }
            // @ts-ignore
            if(this.isPool) await this.client.putTedis(tedis);
        } else console.log(`Could not find instance for ${params.model}`)

        // not cached
        if(!result) {
            result = await next(params);
        }
        
        return result;
    }
}

const gAllProps = (object: any) => {
	const p = new Set();
	do {
		for (const key of Reflect.ownKeys(object)) p.add([object, key]);
	} while ((object = Reflect.getPrototypeOf(object)) && object !== Object.prototype);
	return p;
};

function validate(options:CacheOptions) {
    if(!options || typeof options !== "object") throw new SyntaxError("no valid cacheOptions provided")
    if(typeof options.useAllModels !== "undefined" && typeof options.useAllModels !== "boolean") throw new SyntaxError("option useAllModels was not as a boolean provided");
    if(options.toCache && !Array.isArray(options.toCache)) throw new SyntaxError("No option toCache was provided / option toCache is not a valid Array");
    if(!options.toCache && !options.useAllModels) throw new SyntaxError("No toCache and no useAllModels provided..")
    if(!options.defaultCacheActions || !Array.isArray(options.defaultCacheActions)) throw new SyntaxError("No option defaultCacheActions was provided / option defaultCacheActions is not a valid Array");
    if(options.defaultTTL)
    return true;
}
function bind(o: any) { // @ts-ignore
	for (const [object, key] of gAllProps(o.constructor.prototype)) {
		if (key === 'constructor') continue;
        // find the traget of the property
		const target = Reflect.getOwnPropertyDescriptor(object, key);
		if (target && typeof target.value === 'function') o[key] = o[key].bind(o);
	}
	return o;
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
