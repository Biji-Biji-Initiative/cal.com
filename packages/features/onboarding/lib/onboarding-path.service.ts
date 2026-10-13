// SPDX-License-Identifier: MIT
// The retained profile/calendar/availability flow is the supported self-hosted
// entry. A historical database flag must not restore removed SaaS purchase steps.
export class OnboardingPathService {
  static async getGettingStartedPath(): Promise<string> {
    return "/getting-started";
  }

  static async getGettingStartedPathWhenInvited(): Promise<string> {
    return "/getting-started";
  }

  static async getGettingStartedPathWithParams(queryParams?: Record<string, string>): Promise<string> {
    const basePath = await OnboardingPathService.getGettingStartedPath();
    if (!queryParams || Object.keys(queryParams).length === 0) return basePath;
    return `${basePath}?${new URLSearchParams(queryParams).toString()}`;
  }
}
