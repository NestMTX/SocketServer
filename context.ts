import type { Socket } from 'net'
import { Response } from 'response'
import type { Request } from './request'

/**
 * Defines the shape of the context object passed to each middleware function.
 */
export interface ContextInterface {
  /**
   * The socket that the request was received from.
   */
  readonly socket: Socket
  /**
   * The request that was received.
   */
  readonly request: Request
  /**
   * The response to the request.
   */
  readonly response: Response
  [key: string]: any
}

/**
 * The context object passed to each middleware function.
 */
export class Context implements ContextInterface {
  /**
   * The socket that the request was received from.
   */
  public readonly socket: Socket
  /**
   * The request that was received.
   */
  public readonly request: Request
  /**
   * The response to the request.
   */
  public readonly response: Response

  /**
   * Create a new Context instance.
   * @param socket The socket that the request was received from.
   * @param request The request that was received.
   */
  constructor(socket: Socket, request: Request) {
    this.socket = socket
    this.request = request
    this.response = new Response()
  }
}
