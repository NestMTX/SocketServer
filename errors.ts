/**
 * Error thrown when a required socket path already exists
 */
export class SocketPathAlreadyExistsError extends Error {
  /**
   * Create a new SocketPathAlreadyExistsError instance.
   * @param path The path to the socket file that already exists.
   */
  constructor(path: string) {
    super(`A socket file already exists at "${path}"`)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }
}

/**
 * Error thrown when a required socket path does not exist
 */
export class SocketPathDoesNotExistError extends Error {
  /**
   * Create a new SocketPathDoesNotExistError instance.
   * @param path The path to the socket file that already exists.
   */
  constructor(path: string) {
    super(`The socket file "${path}" does not exist`)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }
}

/**
 * Error returned when a request times out
 */
export class RequestTimeoutError extends Error {
  /**
   * Create a new RequestTimeoutError instance.
   * @param timeout The amount of time that the request was allowed to take before the timeout was returned
   */
  constructor(timeout: number) {
    super(`Request timed out after ${timeout} ms`)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }
}
