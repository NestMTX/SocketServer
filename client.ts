import { EventEmitter } from 'events'
import { existsSync } from 'fs'
import type { Socket } from 'net'
import { createConnection } from 'net'
import { Serializable } from 'types'
import { v4 as uuidv4 } from 'uuid'
import { deserialize, serialize } from 'v8'
import { RequestTimeoutError, SocketPathDoesNotExistError } from './errors'

/**
 * A UNIX Domain Socket Client which is compatible with the {@link SocketClient}.
 */
export class SocketClient {
  readonly #socket: Socket
  readonly #bus: EventEmitter
  readonly #responseBus: EventEmitter

  constructor(path: string) {
    if (!existsSync(path)) {
      throw new SocketPathDoesNotExistError(path)
    }
    this.#socket = createConnection(path, () => {
      this.#log(`Connected to socket at "${path}"`)
    })
    this.#bus = new EventEmitter()
    this.#socket.on('data', (data) => this.#onSocketData(data))
  }

  #onSocketData(data: Buffer): void {
    try {
      const deserialized = deserialize(data)
      if (Array.isArray(deserialize)) {
        const event = deserialized.shift()
        if ('response' === event) {
          const [id, payload] = deserialized as [string, string, Serializable]
          this.#responseBus.emit(id, payload)
        } else {
          this.#bus.emit(`server:${event}`, ...deserialized)
        }
      } else if (
        'object' === typeof deserialized &&
        null !== deserialized &&
        'string' === typeof deserialized.event
      ) {
        if ('response' === deserialized.event) {
          this.#responseBus.emit(deserialized.id, deserialized.payload)
        } else {
          this.#bus.emit(
            `server:${deserialized.event}`,
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

  /**
   * Close the socket connection.
   * @returns Promise<void>
   */
  public async close() {
    return new Promise<void>((resolve) => {
      this.#socket.on('close', () => {
        this.#log('Socket closed')
        resolve()
      })
      this.#socket.end()
    })
  }

  /**
   * Send a request command to the server and wait for a response.
   * @param command The command to send to the server
   * @param payload The payload to send to the server
   * @param abortSignal The signal from the abort controller used to stop listening for a response to the request
   * @param timeout The amount of time to wait for a response to the request
   * @returns Promise<Serializable | void | RequestTimeoutError>
   */
  public async request(
    command: string,
    payload?: Serializable | undefined,
    abortSignal?: AbortSignal,
    timeout: number | undefined = undefined
  ): Promise<Serializable | void | RequestTimeoutError> {
    const rid = uuidv4()
    const raceAbortController = new AbortController()
    let timeoutInstance: NodeJS.Timeout | undefined
    raceAbortController.signal.addEventListener('abort', () => {
      clearTimeout(timeoutInstance)
    })
    const responsePromise = new Promise<Serializable>((resolve) => {
      this.#responseBus.once(rid, resolve)
    })
    const promises: Array<Promise<Serializable | void>> = [responsePromise]
    if (undefined !== abortSignal) {
      abortSignal.addEventListener('abort', () => raceAbortController.abort())
      const abortPromise = new Promise<void>((resolve) => {
        raceAbortController.signal.addEventListener('abort', () => resolve(void 0))
      })
      promises.push(abortPromise)
    }
    if ('number' === typeof timeout && timeout > 0) {
      const timeoutPromise = new Promise<RequestTimeoutError>((resolve) => {
        timeoutInstance = setTimeout(() => {
          resolve(new RequestTimeoutError(timeout))
          raceAbortController.abort()
          clearTimeout(timeoutInstance)
        }, timeout)
      })
      promises.push(timeoutPromise)
    }
    this.#socket.write(serialize(['request', rid, command, payload]))
    return await Promise.race(promises)
  }

  #log(
    msg: string,
    level: 'emerg' | 'alert' | 'crit' | 'error' | 'warning' | 'notice' | 'info' | 'debug' = 'info'
  ) {
    this.#bus.emit('log', msg, level)
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
   * Returns a reference to the `SocketClient`, so that calls can be chained.
   *
   * By default, event listeners are invoked in the order they are added. The`server.prependListener()` method can be used as an alternative to add the
   * event listener to the beginning of the listeners array.
   *
   * ```js
   * import { SocketClient } from '@nestmtx/socket-server';
   * const server = new SocketClient();
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
   * Returns a reference to the `SocketClient`, so that calls can be chained.
   *
   * By default, event listeners are invoked in the order they are added. The`server.prependOnceListener()` method can be used as an alternative to add the
   * event listener to the beginning of the listeners array.
   *
   * ```js
   * import { SocketClient } from '@nestmtx/socket-server';
   * const server = new SocketClient();
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
   * import { SocketClient } from '@nestmtx/socket-server';
   * class MyEmitter extends SocketClient {}
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
   * import { SocketClient } from '@nestmtx/socket-server';
   * const ee = new SocketClient();
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
   * Returns a reference to the `SocketClient`, so that calls can be chained.
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
   * particularly when the `SocketClient` instance was created by some other
   * component or module (e.g. sockets or file streams).
   *
   * Returns a reference to the `SocketClient`, so that calls can be chained.
   */
  public removeAllListeners(event?: string | symbol) {
    return this.#bus.removeAllListeners(event)
  }
  /**
   * By default `SocketClient`s will print a warning if more than `10` listeners are
   * added for a particular event. This is a useful default that helps finding
   * memory leaks. The `server.setMaxListeners()` method allows the limit to be
   * modified for this specific `SocketClient` instance. The value can be set to`Infinity` (or `0`) to indicate an unlimited number of listeners.
   *
   * Returns a reference to the `SocketClient`, so that calls can be chained.
   */
  public setMaxListeners(n: number) {
    return this.#bus.setMaxListeners(n)
  }
  /**
   * Returns the current max listener value for the `SocketClient` which is either
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
   * import { SocketClient } from '@nestmtx/socket-server';
   * const emitter = new SocketClient();
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
   * Sends an event to the `SocketServer` over the socket.
   *
   * Returns `true` if the entire data was flushed successfully to the kernel
   * buffer. Returns `false` if all or part of the data was queued in user memory.`'drain'` will be emitted when the buffer is again free.
   *
   * ```js
   * import { SocketClient, SocketServer } from '@nestmtx/socket-server';
   * const server = new SocketServer();
   * const client = new SocketClient();
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
   * client.emit('event', 1, 2, 3, 4, 5);
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
  public emit(eventName: string | symbol, ...args: any[]): boolean {
    const payload = serialize([eventName, ...args])
    return this.#socket.write(payload)
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
   * Returns a reference to the `SocketClient`, so that calls can be chained.
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
   * Returns a reference to the `SocketClient`, so that calls can be chained.
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
   * import { SocketClient } from '@nestmtx/socket-server';
   *
   * const server = new SocketClient();
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
