import { BaseFormatter, FormatterConfig } from './base';

export class CustomFormatter extends BaseFormatter {
  constructor(
    nameTemplate: string,
    descriptionTemplate: string,
    addonName?: string
  ) {
    super(
      {
        name: nameTemplate,
        description: descriptionTemplate,
      },
      addonName
    );
  }

  public static fromConfig(
    config: FormatterConfig,
    addonName: string | undefined
  ): CustomFormatter {
    return new CustomFormatter(config.name, config.description, addonName);
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
