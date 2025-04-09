import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateCategoryDto {
  @ApiProperty({
    example: 'Home Electronics',
    description: 'Updated name of the category',
    required: false
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    example: 'Updated description',
    description: 'New description for the category',
    required: false
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: false,
    description: 'Set category active status',
    required: false
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}