import { UserData } from '../db/schemas.js';
import { BaseFormatter, FormatterConfig } from './base.js';

export class CustomFormatter extends BaseFormatter {
  constructor(
    nameTemplate: string,
    descriptionTemplate: string,
    userData: UserData
  ) {
    super(
      {
        name: nameTemplate,
        description: descriptionTemplate,
      },
      userData
    );
  }

  public static fromConfig(
    config: FormatterConfig,
    userData: UserData
  ): CustomFormatter {
    return new CustomFormatter(config.name, config.description, userData);
  }

  public updateTemplate(
    nameTemplate: string,
    descriptionTemplate: string
  ): void {
    this.config = {
      name: nameTemplate,
      description: descriptionTemplate,
    };
  }

  public getTemplate(): FormatterConfig {
    return this.config;
  }
}
