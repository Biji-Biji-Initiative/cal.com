import short from "short-uuid";
import { v4 as uuidv4 } from "uuid";

export const generateHashedLink = (_id: number | string) => {
  const translator = short();
  return translator.fromUUID(uuidv4());
};
