import type { Metadata } from "next";
import "./styles.css";
import "./time.css";

export const metadata: Metadata = { title: "おえかきバトル", description: "90秒で描いて、いちばんを決めよう！" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
