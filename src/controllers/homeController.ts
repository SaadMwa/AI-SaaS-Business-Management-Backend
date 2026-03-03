import { Request, Response } from "express";

export const home = (_req: Request, res: Response) => {
  res.status(200).send("Server is running ??");
};
