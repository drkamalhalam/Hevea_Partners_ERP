import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowRight, Leaf, Shield, Sprout, TrendingUp, Handshake, TreePine } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="absolute inset-x-0 top-0 z-50">
        <nav className="flex items-center justify-between p-6 lg:px-8" aria-label="Global">
          <div className="flex lg:flex-1 items-center gap-2 text-primary">
            <Sprout className="h-8 w-8" />
            <span className="font-serif font-bold text-xl">Hevea Partners</span>
          </div>
          <div className="flex flex-1 justify-end items-center gap-4">
            <Link href="/sign-in" className="text-sm font-semibold leading-6 text-foreground hover:text-primary transition-colors">
              Log in
            </Link>
            <Link href="/sign-up" className="text-sm font-semibold leading-6 bg-primary text-primary-foreground px-4 py-2 rounded-md shadow-sm hover:bg-primary/90 transition-colors">
              Partner with us
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero section */}
        <div className="relative isolate pt-14">
          <div className="py-24 sm:py-32 lg:pb-40">
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
              <div className="mx-auto max-w-2xl text-center">
                <div className="mb-8 flex justify-center">
                  <span className="relative rounded-full px-3 py-1 text-sm leading-6 text-muted-foreground ring-1 ring-border hover:ring-primary/50 transition-colors">
                    Tripura's leading natural rubber partnership model.
                  </span>
                </div>
                <h1 className="text-4xl font-serif font-bold tracking-tight text-foreground sm:text-6xl">
                  Rooted in Trust. Growing for Generations.
                </h1>
                <p className="mt-6 text-lg leading-8 text-muted-foreground">
                  We partner with landowners to develop, manage, and scale high-yield natural rubber (Hevea brasiliensis) plantations. Secure your land's future with professional management and transparent revenue sharing.
                </p>
                <div className="mt-10 flex items-center justify-center gap-x-6">
                  <Link href="/sign-up">
                    <Button size="lg" className="gap-2 text-base">
                      Become a Partner <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Link href="#model" className="text-sm font-semibold leading-6 text-foreground hover:text-primary transition-colors">
                    How it works <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </div>
              <div className="mt-16 flow-root sm:mt-24">
                <div className="relative -m-2 rounded-xl bg-muted/50 p-2 ring-1 ring-inset ring-border lg:-m-4 lg:rounded-2xl lg:p-4">
                  <img
                    src="/hero-rubber-plantation.png"
                    alt="Rubber plantation at sunrise"
                    width={2432}
                    height={1442}
                    className="rounded-md shadow-2xl ring-1 ring-border aspect-[16/9] object-cover"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Feature section */}
        <div id="model" className="mx-auto max-w-7xl px-6 lg:px-8 py-24 sm:py-32">
          <div className="mx-auto max-w-2xl lg:text-center">
            <h2 className="text-base font-semibold leading-7 text-primary">The Partnership Model</h2>
            <p className="mt-2 text-3xl font-serif font-bold tracking-tight text-foreground sm:text-4xl">
              Professional management for 35 years
            </p>
            <p className="mt-6 text-lg leading-8 text-muted-foreground">
              Our joint-venture model aligns the interests of landowners and developers. We bring the expertise, capital, and operations. You bring the land. We share the yield.
            </p>
          </div>
          <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-none">
            <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-16 lg:max-w-none lg:grid-cols-3">
              <div className="flex flex-col">
                <dt className="flex items-center gap-x-3 text-base font-semibold leading-7 text-foreground">
                  <Shield className="h-5 w-5 flex-none text-primary" aria-hidden="true" />
                  Legally Binding Deeds
                </dt>
                <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-muted-foreground">
                  <p className="flex-auto">Every partnership is governed by a registered deed detailing land area, notional value, ownership shares, and boundaries.</p>
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="flex items-center gap-x-3 text-base font-semibold leading-7 text-foreground">
                  <Leaf className="h-5 w-5 flex-none text-primary" aria-hidden="true" />
                  Expert Cultivation
                </dt>
                <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-muted-foreground">
                  <p className="flex-auto">From planting to tapping. We manage clones selection, fertilizing, weeding, and disease control to maximize latex yield.</p>
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="flex items-center gap-x-3 text-base font-semibold leading-7 text-foreground">
                  <TrendingUp className="h-5 w-5 flex-none text-primary" aria-hidden="true" />
                  Transparent Revenue
                </dt>
                <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-muted-foreground">
                  <p className="flex-auto">Track your plantation's status, see yearly escalation metrics, and view expected maturity dates through your private dashboard.</p>
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Stats */}
        <div className="bg-primary py-24 sm:py-32 text-primary-foreground">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-2xl lg:max-w-none">
              <div className="text-center mb-16">
                <h2 className="text-3xl font-serif font-bold tracking-tight sm:text-4xl">Growing Tripura's Rubber Economy</h2>
              </div>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-16 text-center lg:grid-cols-4">
                <div className="mx-auto flex max-w-xs flex-col gap-y-4">
                  <dt className="text-base leading-7 text-primary-foreground/80">Hectares Managed</dt>
                  <dd className="order-first text-3xl font-semibold tracking-tight sm:text-5xl">2,500+</dd>
                </div>
                <div className="mx-auto flex max-w-xs flex-col gap-y-4">
                  <dt className="text-base leading-7 text-primary-foreground/80">Active Partners</dt>
                  <dd className="order-first text-3xl font-semibold tracking-tight sm:text-5xl">140+</dd>
                </div>
                <div className="mx-auto flex max-w-xs flex-col gap-y-4">
                  <dt className="text-base leading-7 text-primary-foreground/80">Trees Planted</dt>
                  <dd className="order-first text-3xl font-semibold tracking-tight sm:text-5xl">1.2M</dd>
                </div>
                <div className="mx-auto flex max-w-xs flex-col gap-y-4">
                  <dt className="text-base leading-7 text-primary-foreground/80">Years of Growth</dt>
                  <dd className="order-first text-3xl font-semibold tracking-tight sm:text-5xl">35</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        {/* CTA section */}
        <div className="relative isolate mt-32 px-6 py-32 sm:mt-40 sm:py-40 lg:px-8">
          <svg className="absolute inset-0 -z-10 h-full w-full stroke-muted-foreground/20 [mask-image:radial-gradient(100%_100%_at_top_right,white,transparent)]" aria-hidden="true">
            <defs>
              <pattern id="1d4240d6-ffaf-41c4-8340-07ce5849842e" width="200" height="200" x="50%" y="0" patternUnits="userSpaceOnUse">
                <path d="M.5 200V.5H200" fill="none" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" strokeWidth="0" fill="url(#1d4240d6-ffaf-41c4-8340-07ce5849842e)" />
          </svg>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-serif font-bold tracking-tight text-foreground sm:text-4xl">
              Ready to grow together?
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              Sign up to view sample agreements, explore the financial model, and initiate a conversation with our development team.
            </p>
            <div className="mt-10 flex items-center justify-center gap-x-6">
              <Link href="/sign-up">
                <Button size="lg" className="gap-2 text-base">
                  <Handshake className="h-4 w-4" /> Start Partnership
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-background border-t py-12">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center">
          <div className="flex items-center gap-2 text-muted-foreground mb-4 md:mb-0">
            <TreePine className="h-5 w-5" />
            <span className="font-serif font-semibold">Hevea Partners</span>
          </div>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Hevea Partners, Tripura. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
