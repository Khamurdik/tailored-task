/**
 * Runs before every file in the `api-integration` project.
 *
 * `reflect-metadata` must be imported once, before any decorated class is
 * evaluated — Nest's injector reads `design:paramtypes` off the metadata
 * registry this installs, and without it every constructor injection resolves
 * to `undefined` with an error that names the class rather than the missing
 * import.
 */
import 'reflect-metadata';
