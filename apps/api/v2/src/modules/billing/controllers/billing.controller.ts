import { AppConfig } from "@/config/type";
import { API_VERSIONS_VALUES } from "@/lib/api-versions";
import { MembershipRoles } from "@/modules/auth/decorators/roles/membership-roles.decorator";
import { NextAuthGuard } from "@/modules/auth/guards/next-auth/next-auth.guard";
import { OrganizationRolesGuard } from "@/modules/auth/guards/organization-roles/organization-roles.guard";
import { SubscribeToPlanInput } from "@/modules/billing/controllers/inputs/subscribe-to-plan.input";
import { CheckPlatformBillingResponseDto } from "@/modules/billing/controllers/outputs/CheckPlatformBillingResponse.dto";
import { SubscribeTeamToBillingResponseDto } from "@/modules/billing/controllers/outputs/SubscribeTeamToBillingResponse.dto";
import { BillingService } from "@/modules/billing/services/billing.service";
import { StripeService } from "@/modules/stripe/stripe.service";
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiExcludeController } from "@nestjs/swagger";
import { Request } from "express";

import { ApiResponse } from "@calcom/platform-types";

@Controller({
  path: "/v2/billing",
  version: API_VERSIONS_VALUES,
})
@ApiExcludeController(true)
export class BillingController {
  private readonly stripeWhSecret: string;
  private logger = new Logger("Billing Controller");

  constructor(
    private readonly billingService: BillingService,
    public readonly stripeService: StripeService,
    private readonly configService: ConfigService<AppConfig>
  ) {
    this.stripeWhSecret = configService.get("stripe.webhookSecret", { infer: true }) ?? "";
  }

  @Get("/:teamId/check")
  @UseGuards(NextAuthGuard, OrganizationRolesGuard)
  @MembershipRoles(["OWNER", "ADMIN", "MEMBER"])
  async checkTeamBilling(
    @Param("teamId") teamId: number
  ): Promise<ApiResponse<CheckPlatformBillingResponseDto>> {
    const { status, plan } = await this.billingService.getBillingData(teamId);

    return {
      status: "success",
      data: {
        valid: status === "valid",
        plan,
      },
    };
  }

  @Post("/:teamId/subscribe")
  @UseGuards(NextAuthGuard, OrganizationRolesGuard)
  @MembershipRoles(["OWNER", "ADMIN"])
  async subscribeTeamToStripe(
    @Param("teamId") teamId: number,
    @Body() input: SubscribeToPlanInput
  ): Promise<ApiResponse<SubscribeTeamToBillingResponseDto | undefined>> {
    const { action, url } = await this.billingService.createSubscriptionForTeam(teamId, input.plan);

    if (action === "redirect") {
      return {
        status: "success",
        data: {
          action: "redirect",
          url,
        },
      };
    }

    return {
      status: "success",
    };
  }

  @Post("/:teamId/upgrade")
  @UseGuards(NextAuthGuard, OrganizationRolesGuard)
  @MembershipRoles(["OWNER", "ADMIN"])
  async upgradeTeamBillingInStripe(
    @Param("teamId") teamId: number,
    @Body() input: SubscribeToPlanInput
  ): Promise<ApiResponse<SubscribeTeamToBillingResponseDto | undefined>> {
    const { action, url } = await this.billingService.updateSubscriptionForTeam(teamId, input.plan);

    if (action === "redirect") {
      return {
        status: "success",
        data: {
          action: "redirect",
          url,
        },
      };
    }

    return {
      status: "success",
    };
  }

  @Post("/webhook")
  @HttpCode(HttpStatus.OK)
  async stripeWebhook(
    @Req() request: Request,
    @Headers("stripe-signature") stripeSignature: string
  ): Promise<ApiResponse> {
    const event = await this.billingService.stripeService.stripe.webhooks.constructEventAsync(
      request.body,
      stripeSignature,
      this.stripeWhSecret
    );

    await this.billingService.createOrUpdateStripeSubscription(event);

    return {
      status: "success",
    };
  }
}
