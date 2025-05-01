import { IsEnum, IsNotEmpty, IsOptional, IsBoolean, IsString } from 'class-validator';
import { TemplateType } from '../enums/TemplateType';

export class CreateTemplateDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  content: string;

  @IsNotEmpty()
  @IsEnum(TemplateType)
  type: TemplateType;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean = false;

  @IsOptional()
  @IsString()
  sequentialNumber?: string;
}