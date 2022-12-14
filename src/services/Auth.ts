import fs from 'fs';
import { Config } from '../utils';
import { hashPassword, verifyPasswordWithHash } from '../utils/hash';
import * as jwt from '../utils/jwt';
import { SitePaths } from './SitePaths';

export type User = {
    id: string;
    fullName?: string;
    roles?: string[];
    hashedPassword?: string;
};

export type Token = string | undefined;

export type Tokens = {
    accessToken: Token;
    refreshToken: Token;
}

export class Auth {
    private sitePaths: SitePaths;
    private jwtIssuer: string; //TODO: Add issuer validation
    private jwtAudience: string; //TODO: Add audience validation
    private jwtRefreshExpires: string;
    private jwtAccessExpires: string;
    private jwtRefreshSecret: string;
    private jwtAccessSecret: string;
    private users: { [key: string]: User } = {};
    private usersFile = 'users.json';

    public constructor(config: Config, sitePaths: SitePaths) {
        ({
            jwtIssuer: this.jwtIssuer,
            jwtAudience: this.jwtAudience,
            jwtRefreshExpires: this.jwtRefreshExpires,
            jwtAccessExpires: this.jwtAccessExpires,
            jwtRefreshSecret: this.jwtRefreshSecret,
            jwtAccessSecret: this.jwtAccessSecret
        } = config);

        this.sitePaths = sitePaths;
        this.readUsersFromFile();
    }

    private readUsersFromFile(): void {
        const fullPath = this.sitePaths.getAdminPath(this.usersFile);
        if (fs.existsSync(fullPath)) {
            const usersJson = fs.readFileSync(fullPath, 'utf-8');
            this.users = JSON.parse(usersJson);
        }
    }

    public createUser(id: string, fullName?: string, roles?: string[]): void {
        if (this.users[id]) {
            throw new Error('user already exists');
        }
        this.users[id] = { id, fullName, roles };
        this.writeUsersToFile();
    }

    private writeUsersToFile(): void {
        const fullPath = this.sitePaths.getAdminPath(this.usersFile);
        fs.writeFileSync(fullPath, JSON.stringify(this.users, null, 4));
    }

    public async setPassword(id: string, newPassword: string, oldPassword?: string): Promise<void> {
        this.throwIfNoUser(id);
        if (this.users[id].hashedPassword) {
            if (!oldPassword) {
                throw new Error('old password not entered');
            }
            if (!(await this.verifyPassword(id, oldPassword))) {
                throw new Error('passwords do not match');
            }
        }
        const hashed = await hashPassword(newPassword);
        this.users[id].hashedPassword = hashed;
        this.writeUsersToFile();
    }

    private throwIfNoUser(id: string): void {
        if (!this.users[id]) {
            throw new Error('user does not exist');
        }
    }

    private async verifyPassword(id: string, password: string): Promise<boolean> {
        this.throwIfNoUser(id);
        const hashedPassword = this.users[id]?.hashedPassword;
        if (!hashedPassword) return false;
        return await verifyPasswordWithHash(password, hashedPassword);
    }

    public async getTokensFromPassword(id: string, password: string): Promise<Tokens> {
        this.throwIfNoUser(id);
        if (!(await this.verifyPassword(id, password))) {
            throw new Error('incorrect password');
        }
        return await this.getTokensFromId(id);
    }

    public async getTokensFromRefreshToken(refreshToken: string): Promise<Tokens> {
        const id = await this.verifyRefreshTokenAndGetId(refreshToken);
        return await this.getTokensFromId(id);
    }

    private async verifyRefreshTokenAndGetId(token: string): Promise<string> {
        const payload = await jwt.verify(token, this.jwtRefreshSecret);
        const { id } = payload as User;
        if (!id) {
            throw new Error('id not stored in payload');
        }
        this.throwIfNoUser(id);
        return id;
    } 

    private async getTokensFromId(id: string): Promise<Tokens> {
        const accessToken = await this.getAccessToken(id);
        const refreshToken = await this.getRefreshToken(id);
        return { accessToken, refreshToken };
    }

    private async getAccessToken (id: string): Promise<Token> {
        const payload = {
            id: this.users[id].id,
            fullName: this.users[id].fullName,
            roles: this.users[id].roles
        };
        return await jwt.sign(payload, this.jwtAccessSecret, this.jwtAccessExpires);
    }

    private async getRefreshToken(id: string): Promise<Token> {
        const payload = { id };
        return await jwt.sign(payload, this.jwtRefreshSecret, this.jwtRefreshExpires);
    }

    public async getUserInfoFromAccessToken(token: string): Promise<User> {
        const payload = await jwt.verify(token, this.jwtAccessSecret);
        const { id, fullName, roles } = payload as User;
        return { id, fullName, roles };
    }
}
