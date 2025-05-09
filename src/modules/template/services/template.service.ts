import { Injectable, NotFoundException } from '@nestjs/common';
import { TemplateRepository } from '../repositories/repository/template.repositoty';
import { Template } from '../repositories/entities/template.entity';
import { TemplateType } from '../enums/TemplateType';
import { CreateTemplateDto } from '../dtos/create-template.dto';
import { UpdateTemplateDto } from '../dtos/update-template.dto';
import { PdfService } from 'src/common/pdf/services/pdf.service';
import ejs from 'ejs';

@Injectable()
export class TemplateService {
  constructor(private readonly templateRepository: TemplateRepository,
    private readonly pdfService:PdfService
  ) {}

  async getAllTemplates(): Promise<Template[]> {
    return this.templateRepository.findAllActive();
  }

  async getTemplatesByType(type: TemplateType): Promise<Template[]> {
    return this.templateRepository.findByType(type);
  }

  async getDefaultTemplate(type: TemplateType): Promise<Template | null> {
    return this.templateRepository.findDefaultByType(type);
  }

  async createTemplate(createTemplateDto: CreateTemplateDto): Promise<Template> {
    // Si le nouveau template est marqué comme default, on reset les autres
    const existingTemplate = await this.templateRepository.findOne({
      where: { name: createTemplateDto.name }
  });
  
  if (existingTemplate) {
      throw new Error('Un template avec ce nom existe déjà');
  }
   
    if (createTemplateDto.isDefault) {
      await this.resetDefaultTemplate(createTemplateDto.type);
    }

    const newTemplate = this.templateRepository.create(createTemplateDto);
    return this.templateRepository.save(newTemplate);
  }

  private async resetDefaultTemplate(type: TemplateType): Promise<void> {
    // Utilisez la méthode existante findByType avec un filtre supplémentaire
    const defaultTemplates = (await this.templateRepository.findByType(type))
        .filter(template => template.isDefault);
    
    if (defaultTemplates.length > 0) {
        const ids = defaultTemplates.map(t => t.id);
        await this.templateRepository.updateMultiple(ids, { isDefault: false });
    }
}

async updateTemplate(id: number, updateTemplateDto: UpdateTemplateDto): Promise<Template> {
  // 1. Récupération du template existant
  const template = await this.templateRepository.findOne({
      where: { id }
  });
  
  if (!template || template.deletedAt) {
      throw new NotFoundException(`Template with ID ${id} not found`);
  }

  // Vérifier si le nouveau nom est déjà utilisé par un autre template
  if (updateTemplateDto.name && updateTemplateDto.name !== template.name) {
      const existingTemplate = await this.templateRepository.findOne({
          where: { name: updateTemplateDto.name }
      });
      
      if (existingTemplate) {
          throw new Error('Un template avec ce nom existe déjà');
      }
  }

  // 2. Gestion du changement de template par défaut
  if (updateTemplateDto.isDefault !== undefined && 
      updateTemplateDto.isDefault !== template.isDefault) {
      if (updateTemplateDto.isDefault) {
          await this.resetDefaultTemplate(template.type);
      }
  }

  // 3. Mise à jour manuelle des champs
  const updatedTemplate = {
      ...template,
      ...updateTemplateDto,
      // Ne pas permettre la modification du type s'il est fourni
      type: template.type // Conserve le type original
  };

  // 4. Sauvegarde
  return this.templateRepository.save(updatedTemplate);
}

async deleteTemplate(id: number): Promise<void> {
    const template = await this.templateRepository.findOne({ 
        where: { id } 
    });

    if (!template) {
        throw new NotFoundException(`Template with ID ${id} not found`);
    }

    if (template.isDeletionRestricted) {
        throw new Error('Cannot delete template - deletion is restricted');
    }

    // Soft Delete (mise à jour du champ deletedAt)
    await this.templateRepository.softDelete(id);

    // Si le template supprimé était par défaut, on en choisit un nouveau
    if (template.isDefault) {
        await this.setNewDefaultTemplate(template.type);
    }
}

private async setNewDefaultTemplate(type: TemplateType): Promise<void> {
    const recentTemplate = await this.templateRepository.findOne({
        where: { 
            type,
            deletedAt: null
        },
        order: { createdAt: 'DESC' }
    });

    if (recentTemplate) {
        await this.templateRepository.update(recentTemplate.id, { 
            isDefault: true 
        });
    }
}

async getTemplateById(id: number): Promise<Template> {
    const template = await this.templateRepository.findOne({ 
      where: { id } 
    });

    if (!template || template.deletedAt) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }

    return template;
  }
 


}