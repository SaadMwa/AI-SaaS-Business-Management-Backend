import { Request, Response } from "express";
import { loginUser } from "../services/auth.service";

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const result = await loginUser(email, password);

    if (result.error) {
      return res.status(result.error.status).json({ message: result.error.message });
    }

    return res.status(200).json(result.data);
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err });
  }
};
