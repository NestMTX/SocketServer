import type { Serializable } from './types'
/**
 * An object containing the command and payload of a request.
 */
export class Request {
  /**
   * The id of the request
   */
  public readonly id: string
  /**
   * The command requested
   */
  public readonly command: string
  /**
   * The payload of the command
   */
  public readonly payload?: Serializable | undefined

  /**
   * Create a new Request instance.
   * @param id The id of the request
   * @param command The command requested
   * @param payload The payload of the command
   */
  constructor(id: string, command: string, payload?: Serializable | undefined) {
    this.id = id
    this.command = command
    this.payload = payload
  }
}
