import { IsOptional, IsString, IsEnum, IsBoolean } from 'class-validator';
import { TemplateType } from '../enums/TemplateType';

export class UpdateTemplateDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    content?: string;

    @IsOptional()
    @IsEnum(TemplateType)
    type?: TemplateType;

    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;

    @IsOptional()
    @IsString()
    sequentialNumber?: string;
}