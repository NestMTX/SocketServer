import type { Stream } from 'stream'
/**
 * The type of an array which can be serialized using v8.serialize
 */
export type SerializableArray = Array<Serializable>
/**
 * The type of an async function which can be serialized using v8.serialize
 */
export type SerializableAsyncFunction = (...args: Serializable[]) => Promise<Serializable>
/**
 * The type of an async generator function which can be serialized using v8.serialize
 */
export type SerializableAsyncGeneratorFunction = (
  ...args: Serializable[]
) => AsyncGenerator<Serializable, Serializable, Serializable>
/**
 * The type of a function which can be serialized using v8.serialize
 */
export type SerializableFunction = (...args: Serializable[]) => Serializable
/**
 * The type of a function which can be serialized using v8.serialize
 */
export type SerializableFunctionLike =
  | SerializableFunction
  | SerializableAsyncFunction
  | SerializableGeneratorFunction
  | SerializableAsyncGeneratorFunction
/**
 * The type of a generator function which can be serialized using v8.serialize
 */
export type SerializableGeneratorFunction = (
  ...args: Serializable[]
) => Generator<Serializable, Serializable, Serializable>
/**
 * The type of a map which can be serialized using v8.serialize
 */
export type SerializableMap = Map<Serializable, Serializable>
/**
 * The type of an object which can be serialized using v8.serialize
 */
export type SerializableObject = { [key: SerializableObjectKey]: Serializable }
/**
 * The type of an object key which can be serialized using v8.serialize
 */
export type SerializableObjectKey = string | number | symbol
/**
 * The type of a primitive which can be serialized using v8.serialize
 */
export type SerializablePrimitive = string | number | boolean | null | undefined | symbol
/**
 * The type of a set which can be serialized using v8.serialize
 */
export type SerializableSet = Set<Serializable>
/**
 * The type of a value which can be serialized using v8.serialize
 */
export type Serializable =
  | SerializableArray
  | SerializableAsyncFunction
  | SerializableAsyncGeneratorFunction
  | SerializableFunction
  | SerializableFunctionLike
  | SerializableGeneratorFunction
  | SerializableMap
  | SerializableObject
  | SerializableObjectKey
  | SerializablePrimitive
  | SerializableSet
  | Error
  | Stream
