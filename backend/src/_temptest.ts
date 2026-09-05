import { Request } from "express";

declare global {
  namespace Express {
    interface Request {
      params: { [key: string]: string };
    }
  }
}

export function t(req: Request) {
  const id: string = req.params.id as string;
  const code: string = req.params.code as string;
  return id + code;
}