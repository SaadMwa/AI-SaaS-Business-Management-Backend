import { Router } from "express";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware";
import {
  createCustomer,
  deleteCustomer,
  deleteCustomerByNumber,
  getCustomerById,
  getCustomerByNumber,
  getCustomers,
  updateCustomer,
  updateCustomerByNumber,
} from "../controllers/customer.controller";

const router = Router();

router.get("/", authenticate, requireAdmin, getCustomers);
router.post("/", authenticate, requireAdmin, createCustomer);
router.get("/number/:customer_number", authenticate, requireAdmin, getCustomerByNumber);
router.get("/:id", authenticate, requireAdmin, getCustomerById);
router.put("/number/:customer_number", authenticate, requireAdmin, updateCustomerByNumber);
router.put("/:id", authenticate, requireAdmin, updateCustomer);
router.delete("/number/:customer_number", authenticate, requireAdmin, deleteCustomerByNumber);
router.delete("/:id", authenticate, requireAdmin, deleteCustomer);

export default router;
