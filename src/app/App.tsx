import { MotionConfig } from "motion/react";
import { RouterProvider } from "react-router";
import { router } from "./router";

export function App() {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
      <RouterProvider router={router} />
    </MotionConfig>
  );
}
