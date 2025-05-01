import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm';
import { TemplateType } from '../../enums/TemplateType';

@Entity()
export class Template {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column('text')
  content: string;

  @Column({ type: 'enum', enum: TemplateType })
  type: TemplateType; // 'invoice' | 'quotation' | 'payment'

  @Column({ default: false })
  isDefault: boolean;

  @Column({ nullable: true })
  sequentialNumber: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt: Date;

  @Column({ default: false })
  isDeletionRestricted: boolean;
}