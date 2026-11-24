// The part of os the modules read: os.environ.
import { PyDict } from "./runtime.js";

export const environ = new PyDict(Object.entries(process.env));
