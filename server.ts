import { EventEmitter } from 'events'
import { existsSync, unlinkSync } from 'fs'
import type { Server, Socket } from 'net'
import { createServer } from 'net'
import { Request } from 'request'
import type { Serializable } from 'types'
import { deserialize, serialize } from 'v8'
import { Context } from './context'
import { SocketPathAlreadyExistsError } from './errors'

/**
 * A middleware function which is used to handle incoming socket requestss.
 */
export interface SocketMiddleware {
  (context: Context, next: () => Promise<void>): Promise<void>
}

/**
 * A UNIX Domain Socket Server which can be hooked into similary to the Koa HTTP server
 */
export class SocketServer {
  readonly #path: string
  readonly #server: Server
  readonly #sockets: Set<Socket>
  readonly #bus: EventEmitter
  readonly #middlewares: Array<SocketMiddleware> = []

  /**
   * Create a new SocketServer instance.
   * @param path The path to the socket file to create.
   * @param failOnExists Whether to throw an error if the socket file already exists. Defaults to `true`.
   */
  constructor(path: string, failOnExists: boolean = true) {
    this.#bus = new EventEmitter()
    if (existsSync(path)) {
      if (failOnExists) {
        throw new SocketPathAlreadyExistsError(path)
      } else {
        unlinkSync(path)
        this.#log(`Removing existing socket file at "${path}"`, 'warning')
      }
    }
    this.#path = path
    this.#server = createServer(this.#onConnection.bind(this))
    this.#server.on('error', (err) => {
      this.#log(err.message, 'error')
      this.#bus.emit('error', err)
    })
    this.#sockets = new Set()
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#server.listen(this.#path, () => {
        this.#log(`Listening on socket "${this.#path}"`, 'debug')
        resolve()
      })
      this.#server.once('error', (err) => {
        this.#log(`Error: ${err.message}`, 'error')
        reject(err)
      })
    })
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#server.close((err) => {
        if (err) {
          // @ts-ignore
          if (!err.code || 'ERR_SERVER_NOT_RUNNING' !== err.code) {
            this.#log(`Error: ${err.message}`, 'error')
            reject(err)
          } else {
            this.#log(`Stopped listening on socket "${this.#path}"`, 'debug')
            resolve()
          }
        } else {
          this.#log(`Stopped listening on socket "${this.#path}"`, 'debug')
          resolve()
        }
      })
    })
  }

  public broadcast(event: string, ...args: Serializable[]): void {
    const payload = serialize([event, ...args])
    this.#sockets.forEach((socket) => {
      socket.write(payload, (err) => {
        if (err) {
          this.#log(`Error while broadcasting event "${event}": ${err.message}`, 'error')
        }
      })
    })
  }

  /**
   * Add a middleware function to the server.
   * @param middleware A middleware function which is used to handle incoming socket requests.
   */
  public use(middleware: SocketMiddleware): void {
    this.#middlewares.push(middleware)
  }

  /**
   * Remove a middleware function from the server.
   * @param middleware A middleware function which is used to handle incoming socket requests.
   */
  public unUse(middleware: SocketMiddleware): void {
    let index = this.#middlewares.indexOf(middleware)
    while (index > -1) {
      this.#middlewares.splice(index, 1)
      index = this.#middlewares.indexOf(middleware)
    }
  }

  #log(
    msg: string,
    level: 'emerg' | 'alert' | 'crit' | 'error' | 'warning' | 'notice' | 'info' | 'debug' = 'info'
  ) {
    this.#bus.emit('log', msg, level)
  }

  #onConnection(socket: Socket): void {
    this.#sockets.add(socket)
    this.#log(`New connection from ${socket.remoteAddress}:${socket.remotePort}`, 'debug')
    socket.on('data', (data) => this.#onSocketData(socket, data))
    socket.on('close', () => {
      this.#sockets.delete(socket)
      this.#log(`Connection from ${socket.remoteAddress}:${socket.remotePort} closed`, 'debug')
    })
  }

  #onSocketData(socket: Socket, data: Buffer): void {
    try {
      const deserialized = deserialize(data)
      if (Array.isArray(deserialize)) {
        const event = deserialized.shift()
        if ('request' === event) {
          const [id, command, payload] = deserialized as [string, string, Serializable]
          this.#onRequest(socket, id, command, payload)
        } else {
          this.#bus.emit(`client:${event}`, socket, ...deserialized)
        }
      } else if (
        'object' === typeof deserialized &&
        null !== deserialized &&
        'string' === typeof deserialized.event
      ) {
        if ('request' === deserialized.event) {
          this.#onRequest(socket, deserialized.id, deserialized.command, deserialized.payload)
        } else {
          this.#bus.emit(
            `client:${deserialized.event}`,
            socket,
            ...Object.keys(deserialized)
              .filter((key) => 'event' !== key)
              .map((key) => deserialized[key])
          )
        }
      }
    } catch {
      // noop
    }
  }

  async #onRequest(socket: Socket, id: string, command: string, payload?: Serializable) {
    const request = new Request(id, command, payload)
    const context = new Context(socket, request)
    const doNext = async (currentIndex: number) => {
      const nextIndex = currentIndex + 1
      if (this.#middlewares[nextIndex]) {
        try {
          return await this.#middlewares[nextIndex].apply(null, [
            context,
            doNext.bind(null, nextIndex),
          ])
        } catch (error) {
          return error
        }
      } else {
        return context.response
      }
    }
    const response = await doNext(-1)
    return await new Promise((resolve) => {
      const serialized = serialize({
        event: 'response',
        id: request.id,
        payload: response,
      })
      socket.write(serialized, (err) => {
        if (err) {
          this.#log(`Error while sending response: ${err.message}`, 'error')
        }
        resolve(void 0)
      })
    })
  }

  /**
   * Alias for `server.on(eventName, listener)`.
   */
  public addListener(
    eventName: 'log',
    listener: (
      msg: string,
      level: 'emerg' | 'alert' | 'crit' | 'error' | 'warning' | 'notice' | 'info' | 'debug'
    ) => void
  )
  public addListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
    this.#bus.addListener(eventName, listener)
    return this
  }
  /**
   * Adds the `listener` function to the end of the listeners array for the
   * event named `eventName`. No checks are made to see if the `listener` has
   * already been added. Multiple calls passing the same combination of `eventName`and `listener` will result in the `listener` being added, and called, multiple
   * times.
   *
   * ```js
   * server.on('connection', (stream) => {
   *   console.log('someone connected!');
   * });
   * ```
   *
   * Returns a reference to the `SocketServer`, so that calls can be chained.
   *
   * By default, event listeners are invoked in the order they are added. The`server.prependListener()` method can be used as an alternative to add the
   * event listener to the beginning of the listeners array.
   *
   * ```js
   * import { SocketServer } from '@nestmtx/socket-server';
   * const server = new SocketServer();
   * server.on('foo', () => console.log('a'));
   * server.prependListener('foo', () => console.log('b'));
   * server.emit('foo');
   * // Prints:
   * //   b
   * //   a
   * ```
   * @param eventName The name of the event.
   * @param listener The callback function
   */
  public on(
    eventName: 'log',
    listener: (
      msg: string,
      level: 'emerg' | 'alert' | 'crit' | 'error' | 'warning' | 'notice' | 'info' | 'debug'
    ) => void
  )
  public on(eventName: string | symbol, listener: (...args: any[]) => void): this {
    this.#bus.on(eventName, listener)
    return this
  }
  /**
   * Adds a **one-time**`listener` function for the event named `eventName`. The
   * next time `eventName` is triggered, this listener is removed and then invoked.
   *
   * ```js
   * server.once('connection', (stream) => {
   *   console.log('Ah, we have our first user!');
   * });
   * ```
   *
   * Returns a reference to the `SocketServer`, so that calls can be chained.
   *
   * By default, event listeners are invoked in the order they are added. The`server.prependOnceListener()` method can be used as an alternative to add the
   * event listener to the beginning of the listeners array.
   *
   * ```js
   * import { SocketServer } from '@nestmtx/socket-server';
   * const server = new SocketServer();
   * server.once('foo', () => console.log('a'));
   * server.prependOnceListener('foo', () => console.log('b'));
   * server.emit('foo');
   * // Prints:
   * //   b
   * //   a
   * ```
   * @param eventName The name of the event.
   * @param listener The callback function
   */
  public once(
    eventName: 'log',
    listener: (
      msg: string,
      level: 'emerg' | 'alert' | 'crit' | 'error' | 'warning' | 'notice' | 'info' | 'debug'
    ) => void
  )
  public once(eventName: string | symbol, listener: (...args: any[]) => void): this {
    this.#bus.once(eventName, listener)
    return this
  }
  /**
   * Removes the specified `listener` from the listener array for the event named`eventName`.
   *
   * ```js
   * const callback = (stream) => {
   *   console.log('someone connected!');
   * };
   * server.on('connection', callback);
   * // ...
   * server.removeListener('connection', callback);
   * ```
   *
   * `removeListener()` will remove, at most, one instance of a listener from the
   * listener array. If any single listener has been added multiple times to the
   * listener array for the specified `eventName`, then `removeListener()` must be
   * called multiple times to remove each instance.
   *
   * Once an event is emitted, all listeners attached to it at the
   * time of emitting are called in order. This implies that any`removeListener()` or `removeAllListeners()` calls _after_ emitting and _before_ the last listener finishes execution
   * will not remove them from`emit()` in progress. Subsequent events behave as expected.
   *
   * ```js
   * import { SocketServer } from '@nestmtx/socket-server';
   * class MyEmitter extends SocketServer {}
   * const myEmitter = new MyEmitter();
   *
   * const callbackA = () => {
   *   console.log('A');
   *   server.removeListener('event', callbackB);
   * };
   *
   * const callbackB = () => {
   *   console.log('B');
   * };
   *
   * server.on('event', callbackA);
   *
   * server.on('event', callbackB);
   *
   * // callbackA removes listener callbackB but it will still be called.
   * // Internal listener array at time of emit [callbackA, callbackB]
   * server.emit('event');
   * // Prints:
   * //   A
   * //   B
   *
   * // callbackB is now removed.
   * // Internal listener array [callbackA]
   * server.emit('event');
   * // Prints:
   * //   A
   * ```
   *
   * Because listeners are managed using an internal array, calling this will
   * change the position indices of any listener registered _after_ the listener
   * being removed. This will not impact the order in which listeners are called,
   * but it means that any copies of the listener array as returned by
   * the `server.listeners()` method will need to be recreated.
   *
   * When a single function has been added as a handler multiple times for a single
   * event (as in the example below), `removeListener()` will remove the most
   * recently added instance. In the example the `once('ping')`listener is removed:
   *
   * ```js
   * import { SocketServer } from '@nestmtx/socket-server';
   * const ee = new SocketServer();
   *
   * function pong() {
   *   console.log('pong');
   * }
   *
   * ee.on('ping', pong);
   * ee.once('ping', pong);
   * ee.removeListener('ping', pong);
   *
   * ee.emit('ping');
   * ee.emit('ping');
   * ```
   *
   * Returns a reference to the `SocketServer`, so that calls can be chained.
   */
  public removeListener(
    eventName: 'log',
    listener: (
      msg: string,
      level: 'emerg' | 'alert' | 'crit' | 'error' | 'warning' | 'notice' | 'info' | 'debug'
    ) => void
  )
  public removeListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
    this.#bus.removeListener(eventName, listener)
    return this
  }
  /**
   * Alias for `server.removeListener()`.
   */
  public off(
    eventName: 'log',
    listener: (
      msg: string,
      level: 'emerg' | 'alert' | 'crit' | 'error' | 'warning' | 'notice' | 'info' | 'debug'
    ) => void
  )
  public off(eventName: string | symbol, listener: (...args: any[]) => void): this {
    this.#bus.off(eventName, listener)
    return this
  }
  /**
   * Removes all listeners, or those of the specified `eventName`.
   *
   * It is bad practice to remove listeners added elsewhere in the code,
   * particularly when the `SocketServer` instance was created by some other
   * component or module (e.g. sockets or file streams).
   *
   * Returns a reference to the `SocketServer`, so that calls can be chained.
   */
  public removeAllListeners(event?: string | symbol) {
    return this.#bus.removeAllListeners(event)
  }
  /**
   * By default `SocketServer`s will print a warning if more than `10` listeners are
   * added for a particular event. This is a useful default that helps finding
   * memory leaks. The `server.setMaxListeners()` method allows the limit to be
   * modified for this specific `SocketServer` instance. The value can be set to`Infinity` (or `0`) to indicate an unlimited number of listeners.
   *
   * Returns a reference to the `SocketServer`, so that calls can be chained.
   */
  public setMaxListeners(n: number) {
    return this.#bus.setMaxListeners(n)
  }
  /**
   * Returns the current max listener value for the `SocketServer` which is either
   * set by `server.setMaxListeners(n)` or defaults to {@link defaultMaxListeners}.
   */
  public getMaxListeners(): number {
    return this.#bus.getMaxListeners()
  }
  /**
   * Returns a copy of the array of listeners for the event named `eventName`.
   *
   * ```js
   * server.on('connection', (stream) => {
   *   console.log('someone connected!');
   * });
   * console.log(util.inspect(server.listeners('connection')));
   * // Prints: [ [Function] ]
   * ```
   */
  public listeners(eventName: string | symbol): Function[] {
    return this.#bus.listeners(eventName)
  }
  /**
   * Returns a copy of the array of listeners for the event named `eventName`,
   * including any wrappers (such as those created by `.once()`).
   *
   * ```js
   * import { SocketServer } from '@nestmtx/socket-server';
   * const emitter = new SocketServer();
   * server.once('log', () => console.log('log once'));
   *
   * // Returns a new Array with a function `onceWrapper` which has a property
   * // `listener` which contains the original listener bound above
   * const listeners = server.rawListeners('log');
   * const logFnWrapper = listeners[0];
   *
   * // Logs "log once" to the console and does not unbind the `once` event
   * logFnWrapper.listener();
   *
   * // Logs "log once" to the console and removes the listener
   * logFnWrapper();
   *
   * server.on('log', () => console.log('log persistently'));
   * // Will return a new Array with a single function bound by `.on()` above
   * const newListeners = server.rawListeners('log');
   *
   * // Logs "log persistently" twice
   * newListeners[0]();
   * server.emit('log');
   * ```
   */
  public rawListeners(eventName: string | symbol): Function[] {
    return this.#bus.rawListeners(eventName)
  }
  /**
   * Synchronously calls each of the listeners registered for the event named`eventName`, in the order they were registered, passing the supplied arguments
   * to each.
   *
   * Returns `true` if the event had listeners, `false` otherwise.
   *
   * ```js
   * import { SocketServer } from '@nestmtx/socket-server';
   * const server = new SocketServer();
   *
   * // First listener
   * server.on('event', function firstListener() {
   *   console.log('Helloooo! first listener');
   * });
   * // Second listener
   * server.on('event', function secondListener(arg1, arg2) {
   *   console.log(`event with parameters ${arg1}, ${arg2} in second listener`);
   * });
   * // Third listener
   * server.on('event', function thirdListener(...args) {
   *   const parameters = args.join(', ');
   *   console.log(`event with parameters ${parameters} in third listener`);
   * });
   *
   * console.log(server.listeners('event'));
   *
   * server.emit('event', 1, 2, 3, 4, 5);
   *
   * // Prints:
   * // [
   * //   [Function: firstListener],
   * //   [Function: secondListener],
   * //   [Function: thirdListener]
   * // ]
   * // Helloooo! first listener
   * // event with parameters 1, 2 in second listener
   * // event with parameters 1, 2, 3, 4, 5 in third listener
   * ```
   */
  public emit(
    eventName: 'log',
    msg: string,
    level: 'emerg' | 'alert' | 'crit' | 'error' | 'warning' | 'notice' | 'info' | 'debug'
  ): boolean
  public emit(eventName: string | symbol, ...args: any[]): boolean {
    return this.#bus.emit(eventName, ...args)
  }
  /**
   * Returns the number of listeners listening for the event named `eventName`.
   * If `listener` is provided, it will return how many times the listener is found
   * in the list of the listeners of the event.
   * @param eventName The name of the event being listened for
   * @param listener The event handler function
   */
  public listenerCount(eventName: string | symbol, listener?: Function): number {
    return this.#bus.listenerCount(eventName, listener)
  }
  /**
   * Adds the `listener` function to the _beginning_ of the listeners array for the
   * event named `eventName`. No checks are made to see if the `listener` has
   * already been added. Multiple calls passing the same combination of `eventName`and `listener` will result in the `listener` being added, and called, multiple
   * times.
   *
   * ```js
   * server.prependListener('connection', (stream) => {
   *   console.log('someone connected!');
   * });
   * ```
   *
   * Returns a reference to the `SocketServer`, so that calls can be chained.
   * @param eventName The name of the event.
   * @param listener The callback function
   */
  public prependListener(
    eventName: 'log',
    listener: (
      msg: string,
      level: 'emerg' | 'alert' | 'crit' | 'error' | 'warning' | 'notice' | 'info' | 'debug'
    ) => void
  )
  public prependListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
    this.#bus.prependListener(eventName, listener)
    return this
  }
  /**
   * Adds a **one-time**`listener` function for the event named `eventName` to the _beginning_ of the listeners array. The next time `eventName` is triggered, this
   * listener is removed, and then invoked.
   *
   * ```js
   * server.prependOnceListener('connection', (stream) => {
   *   console.log('Ah, we have our first user!');
   * });
   * ```
   *
   * Returns a reference to the `SocketServer`, so that calls can be chained.
   * @param eventName The name of the event.
   * @param listener The callback function
   */
  public prependOnceListener(
    eventName: 'log',
    listener: (
      msg: string,
      level: 'emerg' | 'alert' | 'crit' | 'error' | 'warning' | 'notice' | 'info' | 'debug'
    ) => void
  )
  public prependOnceListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
    this.#bus.prependOnceListener(eventName, listener)
    return this
  }
  /**
   * Returns an array listing the events for which the emitter has registered
   * listeners. The values in the array are strings or `Symbol`s.
   *
   * ```js
   * import { SocketServer } from '@nestmtx/socket-server';
   *
   * const server = new SocketServer();
   * server.on('foo', () => {});
   * server.on('bar', () => {});
   *
   * const sym = Symbol('symbol');
   * server.on(sym, () => {});
   *
   * console.log(server.eventNames());
   * // Prints: [ 'foo', 'bar', Symbol(symbol) ]
   * ```
   */
  public eventNames(): Array<string | symbol> {
    return this.#bus.eventNames()
  }
}
