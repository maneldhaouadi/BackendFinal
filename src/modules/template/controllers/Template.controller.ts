import { Controller, Get, Query, ParseEnumPipe, NotFoundException, Body, Post, Param, ParseIntPipe, Put, Delete, Res } from '@nestjs/common';
import { TemplateService } from '../services/template.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Template } from '../repositories/entities/template.entity';
import { TemplateType } from '../enums/TemplateType';
import { CreateTemplateDto } from '../dtos/create-template.dto';
import { UpdateTemplateDto } from '../dtos/update-template.dto';
import { Response } from 'express'; // Instead of generic Response

@ApiTags('Templates')
@Controller('templates')
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  @Get()
  @ApiOperation({ summary: 'Récupérer tous les templates actifs' })
  @ApiResponse({ 
    status: 200, 
    description: 'Liste des templates retournée avec succès',
    type: [Template] 
  })
  async getAllTemplates(): Promise<Template[]> {
    return this.templateService.getAllTemplates();
  }

  @Get('by-type')
  @ApiOperation({ summary: 'Filtrer les templates par type' })
  @ApiResponse({ 
    status: 200, 
    description: 'Templates filtrés par type',
    type: [Template] 
  })
  async getTemplatesByType(
    @Query('type', new ParseEnumPipe(TemplateType)) type: TemplateType
  ): Promise<Template[]> {
    return this.templateService.getTemplatesByType(type);
  }

  @Get('default')
  @ApiOperation({ summary: 'Récupérer le template par défaut pour un type' })
  @ApiResponse({ 
    status: 200, 
    description: 'Template par défaut trouvé',
    type: Template 
  })
  async getDefaultTemplate(
    @Query('type', new ParseEnumPipe(TemplateType)) type: TemplateType
  ): Promise<Template> {
    const template = await this.templateService.getDefaultTemplate(type);
    if (!template) {
      throw new NotFoundException(`Aucun template par défaut trouvé pour le type ${type}`);
    }
    return template;
  }
  @Post()
  @ApiOperation({ summary: 'Créer un nouveau template' })
  @ApiResponse({ 
    status: 201, 
    description: 'Template créé avec succès',
    type: Template 
  })
  async createTemplate(
    @Body() createTemplateDto: CreateTemplateDto
  ): Promise<Template> {
    return this.templateService.createTemplate(createTemplateDto);
  }

  @Put(':id')
@ApiOperation({ summary: 'Mettre à jour un template' })
@ApiResponse({ 
    status: 200, 
    description: 'Template mis à jour avec succès',
    type: Template 
})
async updateTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateTemplateDto: UpdateTemplateDto
): Promise<Template> {
    return this.templateService.updateTemplate(id, updateTemplateDto);
}

@Delete(':id')
@ApiOperation({ summary: 'Supprimer un template (soft delete)' })
@ApiResponse({ 
    status: 200, 
    description: 'Template supprimé avec succès' 
})
@ApiResponse({ 
    status: 403, 
    description: 'Suppression interdite (isDeletionRestricted)' 
})
async deleteTemplate(
    @Param('id', ParseIntPipe) id: number
): Promise<void> {
    return this.templateService.deleteTemplate(id);
}

@Get(':id')
  @ApiOperation({ summary: 'Récupérer un template par son ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Template trouvé',
    type: Template 
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Template non trouvé' 
  })
  async getTemplateById(
    @Param('id', ParseIntPipe) id: number
  ): Promise<Template> {
    return this.templateService.getTemplateById(id);
  }

  @Post(':id/export/:format')
  async exportTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Param('format') format: 'pdf' | 'png' | 'docx' | 'jpeg',
    @Body() body: any,
    @Res() res: Response
  ) {
    try {
      const buffer = await this.templateService.exportTemplate(id, format, body);
      
      if (!buffer || buffer.length === 0) {
        throw new Error('Le contenu généré est vide');
      }
  
      res.set({
        'Content-Type': this.getMimeType(format),
        'Content-Disposition': `attachment; filename=template_${id}_${Date.now()}.${format}`,
        'Content-Length': buffer.length
      });
      
      res.end(buffer);
      
    } catch (error) {
      res.status(500).json({
        statusCode: 500,
        message: error.message,
        error: 'Internal Server Error'
      });
    }
  }

private getMimeType(format: string): string {
  const mimeTypes = {
    pdf: 'application/pdf',
    png: 'image/png',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jpeg: 'image/jpeg'
  };
  return mimeTypes[format] || 'application/octet-stream';
}

}