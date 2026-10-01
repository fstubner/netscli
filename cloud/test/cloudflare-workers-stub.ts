/**
 * `cloudflare:workers` exists only inside workerd. workers-oauth-provider
 * imports WorkerEntrypoint from it to tell handler classes from handler
 * objects; this Worker passes objects, so an empty class is all it needs.
 */
export class WorkerEntrypoint {}
