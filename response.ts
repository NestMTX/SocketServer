import type { Serializable } from './types'
/**
 * An object containing the response to a request
 */
export class Response {
  #value: Serializable

  /**
   * The current value of the response
   */
  public get value(): Serializable {
    return this.#value
  }

  /**
   * Set the current value of the response
   */
  public set value(value: Serializable) {
    this.#value = value
  }
}
